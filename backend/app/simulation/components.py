"""Per-component behaviour: one class per ComponentType, behind a shared interface.

This layer sits between the raw M/M/1 formulas and the graph engine. It answers
the two questions the formulas deliberately do not:

  1. What service rate does this component actually have, given its type, any
     per-node override, and how many replicas it runs?
  2. How much traffic does it pass downstream? Most components forward
     everything; a cache absorbs its hits.

Like queueing.py, this module imports nothing from schemas.py or FastAPI. The
API layer converts its Pydantic models into the plain ComponentSpec below, so
the engine stays testable without either dependency.
"""

from __future__ import annotations

from abc import ABC
from dataclasses import dataclass
from typing import ClassVar

from .constants import (
    DEFAULT_CACHE_HIT_RATIO,
    DEFAULT_SERVICE_RATES_RPS,
    UTILIZATION_CRITICAL_THRESHOLD,
    UTILIZATION_SATURATED,
    UTILIZATION_WARNING_THRESHOLD,
    ComponentType,
    NodeStatus,
)
from .queueing import average_latency_seconds, utilization

__all__ = [
    "Component",
    "ComponentAnalysis",
    "ComponentSpec",
    "build_component",
]


@dataclass(frozen=True)
class ComponentSpec:
    """Framework-free description of one node on the canvas.

    Deliberately not schemas.NodeConfig: that type belongs to the API layer, and
    importing it here would drag Pydantic into the simulation engine.
    """

    node_id: str
    component_type: ComponentType
    replicas: int = 1
    service_rate_rps: float | None = None
    hit_ratio: float | None = None

    def __post_init__(self) -> None:
        # The API boundary already enforces these. They are repeated because the
        # engine is a public module in its own right and must not assume it was
        # reached through FastAPI.
        if self.replicas < 1:
            raise ValueError(
                f"node {self.node_id!r}: replicas must be at least 1, "
                f"got {self.replicas}"
            )
        if self.service_rate_rps is not None and self.service_rate_rps <= 0:
            raise ValueError(
                f"node {self.node_id!r}: service rate must be positive, "
                f"got {self.service_rate_rps}"
            )
        if self.hit_ratio is not None and not 0.0 <= self.hit_ratio <= 1.0:
            raise ValueError(
                f"node {self.node_id!r}: hit ratio must be between 0 and 1, "
                f"got {self.hit_ratio}"
            )


@dataclass(frozen=True)
class ComponentAnalysis:
    """What the simulation concluded about one component at one traffic level."""

    node_id: str
    component_type: ComponentType
    arrival_rate_rps: float
    service_rate_rps: float
    utilization: float
    latency_seconds: float | None
    status: NodeStatus
    downstream_rate_rps: float


def _status_for(rho: float) -> NodeStatus:
    """Map utilisation onto the traffic-light status.

    Checked most-severe first so the bands cannot overlap. The thresholds
    themselves live in constants.py, with the reasoning for each.
    """
    if rho >= UTILIZATION_SATURATED:
        return NodeStatus.SATURATED
    if rho >= UTILIZATION_CRITICAL_THRESHOLD:
        return NodeStatus.CRITICAL
    if rho >= UTILIZATION_WARNING_THRESHOLD:
        return NodeStatus.WARNING
    return NodeStatus.HEALTHY


# Populated by Component.__init_subclass__ below. Deriving the mapping from the
# class definitions rather than hand-maintaining a dict is what keeps this
# open/closed: adding a component type means adding a class, and nothing else.
_REGISTRY: dict[ComponentType, type["Component"]] = {}


class Component(ABC):
    """Shared behaviour for every component type.

    Subclasses set `component_type` and override only what differs. In practice
    that is almost nothing: most components differ from one another purely by
    their default service rate, which lives in constants.py.
    """

    component_type: ClassVar[ComponentType]

    def __init_subclass__(cls, **kwargs: object) -> None:
        """Register each subclass against its ComponentType as it is defined.

        Using __init_subclass__ rather than a manual registry means the class
        definition is the single source of truth -- there is no second place to
        forget to update, and a duplicate registration is caught immediately
        rather than silently shadowing an earlier class.
        """
        super().__init_subclass__(**kwargs)
        if not hasattr(cls, "component_type"):
            raise TypeError(f"{cls.__name__} must define a component_type")
        if cls.component_type in _REGISTRY:
            raise TypeError(
                f"{cls.component_type.value} is already handled by "
                f"{_REGISTRY[cls.component_type].__name__}"
            )
        _REGISTRY[cls.component_type] = cls

    def __init__(self, spec: ComponentSpec) -> None:
        self.spec = spec

    @property
    def node_id(self) -> str:
        return self.spec.node_id

    @property
    def replicas(self) -> int:
        return self.spec.replicas

    @property
    def per_instance_service_rate_rps(self) -> float:
        """Service rate of ONE instance: the override if given, else the default.

        Compared against None rather than tested for truthiness, so a caller
        cannot fall back to the default by passing 0.0.
        """
        if self.spec.service_rate_rps is not None:
            return self.spec.service_rate_rps
        return DEFAULT_SERVICE_RATES_RPS[self.component_type]

    def downstream_rate_rps(self, arrival_rate_rps: float) -> float:
        """Traffic this component passes on. Everything, unless overridden."""
        return arrival_rate_rps

    def analyze(self, arrival_rate_rps: float) -> ComponentAnalysis:
        """Evaluate this component under a given arrival rate.

        Replicas are modelled as an even split: N replicas each form an
        independent M/M/1 queue seeing lambda/N. This is deliberately more
        pessimistic than a true M/M/c pool, where replicas share one queue and
        can cover for each other, but it is far easier to reason about and still
        rewards horizontal scaling the way a learner expects.
        """
        per_replica_arrival = arrival_rate_rps / self.replicas
        per_instance_mu = self.per_instance_service_rate_rps
        rho = utilization(per_replica_arrival, per_instance_mu)

        return ComponentAnalysis(
            node_id=self.node_id,
            component_type=self.component_type,
            arrival_rate_rps=arrival_rate_rps,
            # Reported as the aggregate across replicas, since that is the
            # capacity the user actually added. Utilisation is identical either
            # way: (lambda/N) / mu == lambda / (N*mu).
            service_rate_rps=per_instance_mu * self.replicas,
            utilization=rho,
            latency_seconds=average_latency_seconds(
                per_replica_arrival, per_instance_mu
            ),
            status=_status_for(rho),
            downstream_rate_rps=self.downstream_rate_rps(arrival_rate_rps),
        )


class LoadBalancer(Component):
    component_type = ComponentType.LOAD_BALANCER


class AppServer(Component):
    component_type = ComponentType.APP_SERVER


class Database(Component):
    component_type = ComponentType.DATABASE


class MessageQueue(Component):
    component_type = ComponentType.MESSAGE_QUEUE


class Cache(Component):
    """The one component that changes how much traffic continues downstream."""

    component_type = ComponentType.CACHE

    @property
    def hit_ratio(self) -> float:
        if self.spec.hit_ratio is not None:
            return self.spec.hit_ratio
        return DEFAULT_CACHE_HIT_RATIO

    def downstream_rate_rps(self, arrival_rate_rps: float) -> float:
        """Only misses continue on.

        The cache still sees every request -- it has to check before it can
        answer -- so its own arrival rate is unreduced. What shrinks is the load
        on whatever sits behind it, which is the entire reason to add one.
        """
        return arrival_rate_rps * (1.0 - self.hit_ratio)


def build_component(spec: ComponentSpec) -> Component:
    """Construct the Component subclass registered for a spec's type."""
    try:
        component_class = _REGISTRY[spec.component_type]
    except KeyError:  # pragma: no cover - prevented by the import-time check
        raise ValueError(
            f"no component class registered for {spec.component_type!r}"
        ) from None
    return component_class(spec)


# Fail at import time, not mid-simulation, if a ComponentType is ever added to
# the enum without a matching class.
_UNHANDLED = set(ComponentType) - set(_REGISTRY)
if _UNHANDLED:
    raise RuntimeError(
        "component types declared in ComponentType but not implemented: "
        + ", ".join(sorted(component.value for component in _UNHANDLED))
    )
