"""Graph traversal and orchestration: turn a design plus a traffic rate into a result.

This is the only module that knows a design is a *graph*. queueing.py knows the
formulas, components.py knows the component types, and this module knows how
traffic flows between them.

Two modelling decisions are made here, both simplifications worth stating
plainly because they determine every number the app reports:

  Fan-out splits traffic evenly. A node with three outgoing edges sends a third
  of its downstream traffic along each. This makes the classic diagram -- one
  load balancer fanning out to three app servers -- behave the way a learner
  expects, and it is the same even-split assumption used for replicas.

  Total latency is the critical path. A single request traverses one route
  through the graph, so the honest end-to-end figure is the slowest route, not
  the sum of every component in the design.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from .components import ComponentAnalysis, ComponentSpec, build_component
from .constants import NodeStatus

__all__ = ["SimulationError", "SimulationResult", "simulate"]

# A directed hop from one node id to another.
Edge = tuple[str, str]


class SimulationError(Exception):
    """A design the engine cannot simulate: a cycle, no entry point, and so on.

    Distinct from ValueError so the API layer can map structural problems with a
    design (the user's diagram is malformed) onto a different response than
    genuinely invalid numbers.
    """


@dataclass(frozen=True)
class SimulationResult:
    """The outcome of running one design against one traffic rate."""

    is_stable: bool
    total_latency_seconds: float | None
    bottleneck_node_id: str | None
    nodes: list[ComponentAnalysis]


def _build_graph(
    specs: list[ComponentSpec], edges: list[Edge]
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Return (successors, predecessors) adjacency maps, validating as we go."""
    known = {spec.node_id for spec in specs}
    if len(known) != len(specs):
        duplicates = sorted(
            {spec.node_id for spec in specs if [s.node_id for s in specs].count(spec.node_id) > 1}
        )
        raise SimulationError(f"duplicate node ids: {duplicates}")

    successors: dict[str, list[str]] = {spec.node_id: [] for spec in specs}
    predecessors: dict[str, list[str]] = {spec.node_id: [] for spec in specs}

    # Deduplicated, because a repeated edge would otherwise be counted twice
    # when splitting fan-out traffic and quietly halve the share each branch
    # receives.
    for source, target in dict.fromkeys(edges):
        if source not in known or target not in known:
            unknown = sorted({source, target} - known)
            raise SimulationError(
                f"edge {source!r} -> {target!r} references unknown node(s): {unknown}"
            )
        successors[source].append(target)
        predecessors[target].append(source)

    return successors, predecessors


def _topological_order(
    node_ids: list[str], successors: dict[str, list[str]], predecessors: dict[str, list[str]]
) -> list[str]:
    """Kahn's algorithm. Raises if the design has no single entry point or a cycle."""
    entry_points = [node_id for node_id in node_ids if not predecessors[node_id]]

    if not entry_points:
        raise SimulationError(
            "design has no entry point: every component has an incoming edge, "
            "which means the graph contains a cycle"
        )
    if len(entry_points) > 1:
        raise SimulationError(
            "design has more than one entry point "
            f"({', '.join(repr(n) for n in sorted(entry_points))}). "
            "Traffic enters at a single component, so connect them or remove "
            "the extras."
        )

    remaining_indegree = {node_id: len(predecessors[node_id]) for node_id in node_ids}
    queue = deque(entry_points)
    order: list[str] = []

    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for successor in successors[node_id]:
            remaining_indegree[successor] -= 1
            if remaining_indegree[successor] == 0:
                queue.append(successor)

    if len(order) != len(node_ids):
        # With exactly one entry point, any node Kahn could not reach must sit in
        # a subgraph where every node has an incoming edge -- which in a finite
        # graph is only possible if that subgraph contains a cycle.
        unreached = sorted(set(node_ids) - set(order))
        raise SimulationError(
            f"design contains a cycle involving: {unreached}. "
            "Requests must flow forward through the system."
        )

    return order


def _critical_path_seconds(
    order: list[str],
    predecessors: dict[str, list[str]],
    analyses: dict[str, ComponentAnalysis],
) -> float:
    """Longest cumulative latency from the entry point to any component.

    Walking in topological order guarantees every predecessor is already solved
    before it is needed, so one pass is enough.
    """
    cumulative: dict[str, float] = {}

    for node_id in order:
        own_latency = analyses[node_id].latency_seconds
        # Callers only reach this for a stable design, where no latency is None.
        assert own_latency is not None
        slowest_upstream = max(
            (cumulative[p] for p in predecessors[node_id]), default=0.0
        )
        cumulative[node_id] = slowest_upstream + own_latency

    return max(cumulative.values())


def simulate(
    specs: list[ComponentSpec], edges: list[Edge], traffic_rps: float
) -> SimulationResult:
    """Run one design against one steady traffic rate.

    Raises SimulationError if the design is not a well-formed request flow.
    """
    if not specs:
        raise SimulationError("design has no components")
    if not math.isfinite(traffic_rps) or traffic_rps <= 0:
        raise SimulationError(
            f"traffic must be a positive finite rate, got {traffic_rps}"
        )

    successors, predecessors = _build_graph(specs, edges)
    node_ids = [spec.node_id for spec in specs]
    order = _topological_order(node_ids, successors, predecessors)

    components = {spec.node_id: build_component(spec) for spec in specs}
    arrival_rates = dict.fromkeys(node_ids, 0.0)
    arrival_rates[order[0]] = traffic_rps

    analyses: dict[str, ComponentAnalysis] = {}
    for node_id in order:
        analysis = components[node_id].analyze(arrival_rates[node_id])
        analyses[node_id] = analysis

        outgoing = successors[node_id]
        if outgoing:
            share = analysis.downstream_rate_rps / len(outgoing)
            for successor in outgoing:
                arrival_rates[successor] += share

    # Reported in the order the caller supplied, not traversal order, so the
    # frontend can zip results against its own node list.
    results = [analyses[node_id] for node_id in node_ids]

    is_stable = all(
        analysis.status is not NodeStatus.SATURATED for analysis in results
    )

    return SimulationResult(
        is_stable=is_stable,
        # One infinite term makes the sum meaningless rather than merely large,
        # so an unstable design reports no total at all.
        total_latency_seconds=(
            _critical_path_seconds(order, predecessors, analyses)
            if is_stable
            else None
        ),
        bottleneck_node_id=max(results, key=lambda a: a.utilization).node_id,
        nodes=results,
    )
