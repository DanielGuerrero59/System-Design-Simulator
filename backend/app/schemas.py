"""Pydantic models for the /simulate API boundary.

This module is the contract between the React frontend and the simulation
engine. Nothing but these types should cross the boundary -- no raw dicts --
so that a malformed graph is rejected here with a clear 422 rather than
producing a confident, wrong number downstream.

Note the direction of the import below: this API layer depends on the
simulation package, never the reverse. The engine must stay usable (and unit
testable) without FastAPI or Pydantic in the picture.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from .simulation.constants import (
    MAX_REPLICAS,
    MAX_TRAFFIC_RPS,
    MIN_REPLICAS,
    ComponentType,
    NodeStatus,
)


# --- Request ---------------------------------------------------------------


class NodeConfig(BaseModel):
    """Per-node knobs the user can turn in the sidebar.

    Every field is optional with a sensible default, so the frontend can add a
    node to the canvas without deciding anything up front.
    """

    replicas: int = Field(
        default=1,
        ge=MIN_REPLICAS,
        le=MAX_REPLICAS,
        description="Instances of this component. Traffic splits evenly across them.",
    )
    service_rate_rps: float | None = Field(
        default=None,
        gt=0,
        description=(
            "Override for this component's per-instance service rate (mu). "
            "None means fall back to the type default in constants.py. This is "
            "what makes 'upgrade the database' a thing the user can try."
        ),
    )
    hit_ratio: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description=(
            "Cache only. Fraction of requests served from cache, so downstream "
            "components see lambda * (1 - hit_ratio)."
        ),
    )


class Node(BaseModel):
    """One component on the canvas."""

    id: str = Field(min_length=1, description="Stable id, supplied by React Flow.")
    type: ComponentType
    config: NodeConfig = Field(default_factory=NodeConfig)

    @model_validator(mode="after")
    def reject_hit_ratio_on_non_cache(self) -> Node:
        """A hit ratio on a database is meaningless and would be silently ignored.

        Failing loudly here is kinder than accepting the field and quietly
        producing a result the user cannot explain.
        """
        if self.config.hit_ratio is not None and self.type is not ComponentType.CACHE:
            raise ValueError(
                f"hit_ratio is only valid on a {ComponentType.CACHE.value} node, "
                f"but node {self.id!r} is a {self.type.value}"
            )
        return self


class Edge(BaseModel):
    """A directed hop a request takes from one component to the next."""

    source: str = Field(min_length=1)
    target: str = Field(min_length=1)


class TrafficPattern(BaseModel):
    """The load offered to the entry point of the system.

    A single steady rate for now. Spike and ramp presets will extend this
    model rather than replace it.
    """

    requests_per_second: float = Field(gt=0, le=MAX_TRAFFIC_RPS)


class SimulationRequest(BaseModel):
    """A complete design plus the load to run against it."""

    nodes: list[Node] = Field(min_length=1)
    edges: list[Edge] = Field(default_factory=list)
    traffic: TrafficPattern

    @model_validator(mode="after")
    def check_graph_is_well_formed(self) -> SimulationRequest:
        """Structural checks only -- cheap, and independent of the queueing model.

        Deeper questions (is the graph connected? are there cycles?) need graph
        traversal and belong with the engine, not in a schema validator.
        """
        ids = [node.id for node in self.nodes]
        duplicates = {node_id for node_id in ids if ids.count(node_id) > 1}
        if duplicates:
            raise ValueError(f"duplicate node ids: {sorted(duplicates)}")

        known = set(ids)
        for edge in self.edges:
            unknown = {edge.source, edge.target} - known
            if unknown:
                raise ValueError(
                    f"edge {edge.source!r} -> {edge.target!r} references "
                    f"unknown node(s): {sorted(unknown)}"
                )
            if edge.source == edge.target:
                raise ValueError(f"node {edge.source!r} cannot connect to itself")

        return self


# --- Response --------------------------------------------------------------


class NodeResult(BaseModel):
    """What the simulation concluded about a single component."""

    node_id: str
    arrival_rate_rps: float = Field(
        description="Effective lambda reaching this component, after upstream "
        "cache hits and replica splitting."
    )
    service_rate_rps: float = Field(
        description="Effective mu for this component, across all its replicas."
    )
    utilization: float = Field(
        description="rho = lambda / mu. Values >= 1.0 mean the queue grows without bound."
    )
    latency_ms: float | None = Field(
        description=(
            "Average time in system (queue wait + service) at this component. "
            "None when saturated: the value is infinite, and JSON has no way to "
            "represent infinity."
        )
    )
    status: NodeStatus


class SimulationResponse(BaseModel):
    """The result of running one design against one traffic pattern."""

    is_stable: bool = Field(
        description="False if any component is saturated (rho >= 1)."
    )
    total_latency_ms: float | None = Field(
        description=(
            "Sum of per-component latencies along the request path. None when "
            "the system is unstable, since one infinite term makes the sum "
            "meaningless rather than large."
        )
    )
    bottleneck_node_id: str | None = Field(
        description="The component with the highest utilisation -- the one worth fixing first."
    )
    nodes: list[NodeResult]
