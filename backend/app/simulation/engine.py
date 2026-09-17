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
from collections import Counter, deque
from collections.abc import Sequence
from dataclasses import dataclass

from .components import Component, ComponentAnalysis, ComponentSpec, build_component
from .constants import NodeStatus
from .traffic import TrafficStep

__all__ = [
    "SimulationError",
    "SimulationResult",
    "TimelineResult",
    "TimelineStepResult",
    "simulate",
    "simulate_timeline",
]

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


@dataclass(frozen=True)
class TimelineStepResult:
    """One sample of a timeline: what was offered, and what the design did with it."""

    t_seconds: float
    offered_rps: float
    result: SimulationResult


@dataclass(frozen=True)
class TimelineResult:
    """The outcome of running one design against a sequence of offered rates.

    Each step is its own steady state; nothing carries over between them. See
    traffic.py for why that is a forgiving simplification.
    """

    steps: list[TimelineStepResult]
    # The sample closest to (or furthest past) saturation -- the moment worth
    # showing when only one can be shown.
    worst_index: int
    saturated_steps: int

    @property
    def worst(self) -> SimulationResult:
        return self.steps[self.worst_index].result


def _build_graph(
    specs: list[ComponentSpec], edges: list[Edge]
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Return (successors, predecessors) adjacency maps, validating as we go."""
    known = {spec.node_id for spec in specs}
    if len(known) != len(specs):
        # One pass. The nested-count form is quadratic and runs on precisely the
        # request a user is about to retry after fixing their diagram.
        counts = Counter(spec.node_id for spec in specs)
        duplicates = sorted(node_id for node_id, n in counts.items() if n > 1)
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
) -> tuple[list[str], str]:
    """Kahn's algorithm. Raises if the design has no single entry point or a cycle.

    Returns the traversal order *and* the entry point. Handing back the entry
    explicitly keeps callers from having to assume it lands at order[0] -- true
    today, but only as a side effect of how the queue below is seeded.
    """
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

    return order, entry_points[0]


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
        if own_latency is None:
            # Only reachable if a caller skips the stability check. Raised rather
            # than asserted because python -O strips asserts, and the failure
            # without one is an opaque TypeError deep in this loop.
            raise SimulationError(
                f"cannot measure a path through saturated component {node_id!r}"
            )
        slowest_upstream = max(
            (cumulative[p] for p in predecessors[node_id]), default=0.0
        )
        cumulative[node_id] = slowest_upstream + own_latency

    return max(cumulative.values())


def _validate_traffic_rate(traffic_rps: float) -> None:
    if not math.isfinite(traffic_rps) or traffic_rps <= 0:
        raise SimulationError(
            f"traffic must be a positive finite rate, got {traffic_rps}"
        )


@dataclass(frozen=True)
class _PreparedDesign:
    """A validated design, ready to be run at any number of traffic rates.

    Everything here depends only on the graph, so a timeline pays for the
    validation and the topological sort once rather than once per sample.
    """

    node_ids: list[str]
    order: list[str]
    entry_node: str
    successors: dict[str, list[str]]
    predecessors: dict[str, list[str]]
    components: dict[str, Component]


def _prepare_design(specs: list[ComponentSpec], edges: list[Edge]) -> _PreparedDesign:
    if not specs:
        raise SimulationError("design has no components")

    successors, predecessors = _build_graph(specs, edges)
    node_ids = [spec.node_id for spec in specs]
    order, entry_node = _topological_order(node_ids, successors, predecessors)

    return _PreparedDesign(
        node_ids=node_ids,
        order=order,
        entry_node=entry_node,
        successors=successors,
        predecessors=predecessors,
        components={spec.node_id: build_component(spec) for spec in specs},
    )


def _run(design: _PreparedDesign, traffic_rps: float) -> SimulationResult:
    """Propagate one steady rate through a prepared design."""
    arrival_rates = dict.fromkeys(design.node_ids, 0.0)
    arrival_rates[design.entry_node] = traffic_rps

    analyses: dict[str, ComponentAnalysis] = {}
    for node_id in design.order:
        analysis = design.components[node_id].analyze(arrival_rates[node_id])
        analyses[node_id] = analysis

        outgoing = design.successors[node_id]
        if outgoing:
            share = analysis.downstream_rate_rps / len(outgoing)
            for successor in outgoing:
                arrival_rates[successor] += share

    # Reported in the order the caller supplied, not traversal order, so the
    # frontend can zip results against its own node list.
    results = [analyses[node_id] for node_id in design.node_ids]

    is_stable = all(
        analysis.status is not NodeStatus.SATURATED for analysis in results
    )

    return SimulationResult(
        is_stable=is_stable,
        # One infinite term makes the sum meaningless rather than merely large,
        # so an unstable design reports no total at all.
        total_latency_seconds=(
            _critical_path_seconds(design.order, design.predecessors, analyses)
            if is_stable
            else None
        ),
        bottleneck_node_id=max(results, key=lambda a: a.utilization).node_id,
        nodes=results,
    )


def _peak_utilization(result: SimulationResult) -> float:
    return max(analysis.utilization for analysis in result.nodes)


def simulate(
    specs: list[ComponentSpec], edges: list[Edge], traffic_rps: float
) -> SimulationResult:
    """Run one design against one steady traffic rate.

    Raises SimulationError if the design is not a well-formed request flow.
    """
    design = _prepare_design(specs, edges)
    _validate_traffic_rate(traffic_rps)
    return _run(design, traffic_rps)


def simulate_timeline(
    specs: list[ComponentSpec], edges: list[Edge], steps: Sequence[TrafficStep]
) -> TimelineResult:
    """Run one design against a sequence of offered rates, one steady state each.

    The design is validated and sorted once, then evaluated per sample. The
    engine never sees the shape that produced the steps -- a new shape is a new
    profile in traffic.py and nothing here changes.

    Raises SimulationError for a malformed design, an empty timeline, or a
    step whose rate is not a positive finite number.
    """
    if not steps:
        raise SimulationError("traffic timeline has no steps")

    design = _prepare_design(specs, edges)

    results: list[TimelineStepResult] = []
    for step in steps:
        _validate_traffic_rate(step.rps)
        results.append(
            TimelineStepResult(
                t_seconds=step.t_seconds,
                offered_rps=step.rps,
                result=_run(design, step.rps),
            )
        )

    # Judged by the busiest component, which utilisation keeps well-defined
    # past saturation because it is reported uncapped. max() returns the first
    # maximum, so a burst is reported at the second it begins, not somewhere
    # inside it.
    worst_index = max(
        range(len(results)), key=lambda i: _peak_utilization(results[i].result)
    )

    return TimelineResult(
        steps=results,
        worst_index=worst_index,
        saturated_steps=sum(1 for r in results if not r.result.is_stable),
    )
