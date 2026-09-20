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

from collections import Counter
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Discriminator, Field, Tag, model_validator

from .simulation.constants import (
    DEFAULT_SPIKE_SECONDS,
    DEFAULT_SPIKE_START_SECONDS,
    DEFAULT_TRAFFIC_DURATION_SECONDS,
    MAX_EDGES,
    MAX_NODES,
    MAX_REPLICAS,
    MAX_SERVICE_RATE_RPS,
    MAX_TRAFFIC_DURATION_SECONDS,
    MAX_TRAFFIC_RPS,
    MIN_REPLICAS,
    ComponentType,
    NodeStatus,
    TrafficKind,
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
        le=MAX_SERVICE_RATE_RPS,
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


class SteadyTraffic(BaseModel):
    """One rate, held for the whole run: the original model, and the default.

    `kind` is optional here and nowhere else, so the body every client has
    always sent -- {"requests_per_second": N} -- keeps meaning what it meant.
    """

    kind: Literal["steady"] = "steady"
    requests_per_second: float = Field(gt=0, le=MAX_TRAFFIC_RPS)


class SpikeTraffic(BaseModel):
    """A baseline with one burst: the shape of a launch, a sale, a retry storm.

    Evaluated one sample per second. A component the burst pushes over
    capacity queues the excess, and that backlog carries into the seconds
    after the burst, draining at the spare capacity -- so the damage outlasts
    the burst, and the window after it is where the recovery shows.
    """

    kind: Literal["spike"]
    baseline_rps: float = Field(gt=0, le=MAX_TRAFFIC_RPS)
    peak_rps: float = Field(
        gt=0, le=MAX_TRAFFIC_RPS, description="Must exceed baseline_rps."
    )
    duration_seconds: int = Field(
        default=DEFAULT_TRAFFIC_DURATION_SECONDS,
        ge=1,
        le=MAX_TRAFFIC_DURATION_SECONDS,
        description="Length of the whole window, including time before and after the burst.",
    )
    peak_start_seconds: int = Field(default=DEFAULT_SPIKE_START_SECONDS, ge=0)
    peak_seconds: int = Field(
        default=DEFAULT_SPIKE_SECONDS,
        ge=1,
        description=(
            "Burst length. The burst is the half-open window "
            "[peak_start_seconds, peak_start_seconds + peak_seconds)."
        ),
    )

    @model_validator(mode="after")
    def check_burst_is_a_burst(self) -> SpikeTraffic:
        """A peak at or below the baseline is not a spike, and the burst must fit."""
        if self.peak_rps <= self.baseline_rps:
            raise ValueError(
                f"peak_rps must exceed baseline_rps, got {self.peak_rps} "
                f"against {self.baseline_rps}"
            )
        burst_end = self.peak_start_seconds + self.peak_seconds
        if burst_end > self.duration_seconds:
            raise ValueError(
                f"the burst ends at {burst_end}s, after the "
                f"{self.duration_seconds}s window"
            )
        return self


class RampTraffic(BaseModel):
    """A straight line from start_rps at t = 0 to end_rps at t = duration.

    Sweeping the rate is the clearest picture of the M/M/1 curve itself:
    latency creeping, then turning sharply upward, then a component saturating
    at a rate you can read off the axis. Downward ramps are allowed.
    """

    kind: Literal["ramp"]
    start_rps: float = Field(gt=0, le=MAX_TRAFFIC_RPS)
    end_rps: float = Field(gt=0, le=MAX_TRAFFIC_RPS)
    duration_seconds: int = Field(
        default=DEFAULT_TRAFFIC_DURATION_SECONDS,
        ge=1,
        le=MAX_TRAFFIC_DURATION_SECONDS,
    )


def _traffic_kind(value: Any) -> str:
    """Choose the traffic model by its tag. A missing tag means steady.

    A callable discriminator rather than Field(discriminator="kind"), because
    that form rejects a body with no tag outright -- and the tagless body is
    the one every existing client sends.
    """
    if isinstance(value, dict):
        return value.get("kind", TrafficKind.STEADY.value)
    return getattr(value, "kind", TrafficKind.STEADY.value)


# The load offered to the entry point of the system: one of the shapes above.
TrafficPattern = Annotated[
    Union[
        Annotated[SteadyTraffic, Tag(TrafficKind.STEADY.value)],
        Annotated[SpikeTraffic, Tag(TrafficKind.SPIKE.value)],
        Annotated[RampTraffic, Tag(TrafficKind.RAMP.value)],
    ],
    Discriminator(_traffic_kind),
]


class SimulationRequest(BaseModel):
    """A complete design plus the load to run against it."""

    # Upper bounds are a guard on a public endpoint, not a modelling limit:
    # without them one request can hand the server an arbitrary amount of work.
    nodes: list[Node] = Field(min_length=1, max_length=MAX_NODES)
    edges: list[Edge] = Field(default_factory=list, max_length=MAX_EDGES)
    traffic: TrafficPattern

    @model_validator(mode="after")
    def check_graph_is_well_formed(self) -> SimulationRequest:
        """Structural checks only -- cheap, and independent of the queueing model.

        Deeper questions (is the graph connected? are there cycles?) need graph
        traversal and belong with the engine, not in a schema validator.
        """
        ids = [node.id for node in self.nodes]
        # Counter is one pass; the obvious `ids.count(x) for x in ids` is
        # quadratic and runs on exactly the request a confused user retries.
        duplicates = {node_id for node_id, n in Counter(ids).items() if n > 1}
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
        description=(
            "rho = lambda / mu, the offered load. Values >= 1.0 mean the queue "
            "grows without bound. Unaffected by any backlog: see `backlog`."
        )
    )
    latency_ms: float | None = Field(
        description=(
            "Average time in system (queue wait + service) at this component, "
            "including the time to clear any backlog ahead of the request. None "
            "when saturated: the value is infinite, and JSON has no way to "
            "represent infinity."
        )
    )
    backlog: float = Field(
        description=(
            "Requests queued beyond what the steady state accounts for when this "
            "sample begins, summed across replicas. Only ever non-zero after an "
            "earlier sample saturated this component; it drains at the spare "
            "capacity once the rate drops back under mu, and a component still "
            "draining is classified by the latency that queue costs, not by "
            "utilization alone."
        )
    )
    status: NodeStatus


class StepResult(BaseModel):
    """What the simulation concluded about the whole design at one offered rate."""

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
        description=(
            "The component worth fixing first: the highest utilisation, or the "
            "one still draining the deepest backlog when that costs more."
        )
    )
    nodes: list[NodeResult]


class TimelineStep(StepResult):
    """One sample of the timeline: the rate that arrived, and what it did."""

    t_seconds: float
    offered_rps: float = Field(
        description="The rate arriving at the entry point during this sample."
    )


class TrafficSummary(BaseModel):
    """The shape that was run, and where in it the design hurt most."""

    kind: TrafficKind
    duration_seconds: float = Field(
        description="Time of the last sample. 0 for a steady rate, which is a single sample."
    )
    peak_rps: float = Field(description="Highest offered rate in the timeline.")
    worst_step_index: int = Field(
        description=(
            "Index into `timeline` of the sample the top-level fields describe: "
            "the one whose busiest component is closest to, or furthest past, "
            "saturation. Earliest on ties, so a burst is reported at its first second."
        )
    )
    saturated_seconds: float = Field(
        description="How much of the window had at least one saturated component."
    )
    recovery_seconds: float = Field(
        description=(
            "How much of the window was spent draining: seconds in which nothing "
            "was saturated but some component still had a backlog from earlier. "
            "The tail a burst leaves behind."
        )
    )


class SimulationResponse(StepResult):
    """The result of running one design against one traffic pattern.

    The top-level fields describe the WORST sample of the timeline. For a
    steady rate that is the only sample, so a client written against the
    original single-rate contract sees exactly what it always did; the full
    sequence is in `timeline`.

    Each sample is solved as a steady state at its own rate, starting from the
    backlog the previous sample left queued. A design that never saturates
    never queues anything, and its timeline is one independent steady state
    per second.
    """

    traffic: TrafficSummary
    timeline: list[TimelineStep]
