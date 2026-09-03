"""Unit tests for component behaviour: service rates, replicas, cache hits, status."""

from __future__ import annotations

import pytest

from app.simulation.components import (
    Component,
    ComponentSpec,
    build_component,
)
from app.simulation.constants import (
    DEFAULT_CACHE_HIT_RATIO,
    DEFAULT_SERVICE_RATES_RPS,
    ComponentType,
    NodeStatus,
)


def spec(component_type: ComponentType, **kwargs: object) -> ComponentSpec:
    return ComponentSpec(node_id="n", component_type=component_type, **kwargs)  # type: ignore[arg-type]


class TestServiceRate:
    @pytest.mark.parametrize("component_type", list(ComponentType))
    def test_defaults_come_from_constants(self, component_type: ComponentType) -> None:
        component = build_component(spec(component_type))
        assert component.per_instance_service_rate_rps == (
            DEFAULT_SERVICE_RATES_RPS[component_type]
        )

    def test_override_wins(self) -> None:
        component = build_component(
            spec(ComponentType.DATABASE, service_rate_rps=12_000.0)
        )
        assert component.per_instance_service_rate_rps == 12_000.0

    def test_reported_rate_is_aggregate_across_replicas(self) -> None:
        """The user added 4 boxes, so the response should say 4 boxes' worth."""
        analysis = build_component(
            spec(ComponentType.APP_SERVER, replicas=4, service_rate_rps=1_000.0)
        ).analyze(100.0)
        assert analysis.service_rate_rps == 4_000.0


class TestReplicas:
    def test_traffic_splits_evenly(self) -> None:
        """4 replicas at mu=1000 each, 2000 rps total -> each sees 500.

        rho = 500/1000 = 0.5 and W = 1/(1000-500) = 2 ms.
        """
        analysis = build_component(
            spec(ComponentType.APP_SERVER, replicas=4, service_rate_rps=1_000.0)
        ).analyze(2_000.0)
        assert analysis.utilization == pytest.approx(0.5)
        assert analysis.latency_seconds == pytest.approx(0.002)

    def test_replicas_do_not_behave_as_one_faster_server(self) -> None:
        """The distinction that makes this M/M/1-per-replica, not M/M/1 aggregate.

        2 replicas at mu=1000 under 1000 rps: each sees 500, so
        W = 1/(1000-500) = 2 ms. Modelling it as a single mu=2000 server would
        give 1/(2000-1000) = 1 ms, which is the more optimistic M/M/c-ish answer
        this model deliberately does not give.
        """
        analysis = build_component(
            spec(ComponentType.APP_SERVER, replicas=2, service_rate_rps=1_000.0)
        ).analyze(1_000.0)
        assert analysis.latency_seconds == pytest.approx(0.002)
        assert analysis.latency_seconds != pytest.approx(0.001)

    def test_adding_replicas_relieves_saturation(self) -> None:
        overloaded = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=1_000.0)
        ).analyze(1_500.0)
        assert overloaded.status is NodeStatus.SATURATED

        scaled = build_component(
            spec(ComponentType.APP_SERVER, replicas=3, service_rate_rps=1_000.0)
        ).analyze(1_500.0)
        assert scaled.status is NodeStatus.HEALTHY


class TestDownstreamTraffic:
    def test_most_components_pass_everything_on(self) -> None:
        for component_type in ComponentType:
            if component_type is ComponentType.CACHE:
                continue
            component = build_component(spec(component_type))
            assert component.downstream_rate_rps(1_000.0) == 1_000.0

    def test_cache_forwards_only_misses(self) -> None:
        component = build_component(spec(ComponentType.CACHE, hit_ratio=0.9))
        assert component.downstream_rate_rps(10_000.0) == pytest.approx(1_000.0)

    def test_cache_still_sees_every_request_itself(self) -> None:
        """A cache has to be asked before it can answer, so its own lambda is full."""
        analysis = build_component(
            spec(ComponentType.CACHE, hit_ratio=0.9)
        ).analyze(10_000.0)
        assert analysis.arrival_rate_rps == 10_000.0
        assert analysis.downstream_rate_rps == pytest.approx(1_000.0)

    def test_cache_uses_default_hit_ratio_when_unset(self) -> None:
        component = build_component(spec(ComponentType.CACHE))
        expected = 1_000.0 * (1.0 - DEFAULT_CACHE_HIT_RATIO)
        assert component.downstream_rate_rps(1_000.0) == pytest.approx(expected)

    @pytest.mark.parametrize(
        ("hit_ratio", "expected_downstream"),
        [(0.0, 1_000.0), (1.0, 0.0)],
    )
    def test_hit_ratio_extremes(
        self, hit_ratio: float, expected_downstream: float
    ) -> None:
        component = build_component(spec(ComponentType.CACHE, hit_ratio=hit_ratio))
        assert component.downstream_rate_rps(1_000.0) == pytest.approx(
            expected_downstream
        )


class TestStatusThresholds:
    @pytest.mark.parametrize(
        ("arrival_rate", "expected"),
        [
            (0.0, NodeStatus.HEALTHY),
            (690.0, NodeStatus.HEALTHY),
            (700.0, NodeStatus.WARNING),  # exactly at the 0.70 threshold
            (840.0, NodeStatus.WARNING),
            (850.0, NodeStatus.CRITICAL),  # exactly at the 0.85 threshold
            (999.0, NodeStatus.CRITICAL),
            (1_000.0, NodeStatus.SATURATED),  # rho exactly 1.0
            (2_000.0, NodeStatus.SATURATED),
        ],
    )
    def test_bands(self, arrival_rate: float, expected: NodeStatus) -> None:
        analysis = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=1_000.0)
        ).analyze(arrival_rate)
        assert analysis.status is expected

    def test_saturated_reports_no_latency(self) -> None:
        analysis = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=1_000.0)
        ).analyze(1_000.0)
        assert analysis.latency_seconds is None


class TestSpecValidation:
    def test_rejects_zero_replicas(self) -> None:
        with pytest.raises(ValueError, match="replicas must be at least 1"):
            ComponentSpec("n", ComponentType.APP_SERVER, replicas=0)

    def test_rejects_non_positive_service_rate(self) -> None:
        with pytest.raises(ValueError, match="service rate must be a positive finite number"):
            ComponentSpec("n", ComponentType.DATABASE, service_rate_rps=0.0)

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    def test_rejects_non_finite_service_rate(self, bad: float) -> None:
        """NaN slips past a bare `<= 0`, so the spec must check finiteness itself.

        Caught here rather than deeper in queueing.py, whose error cannot name
        the offending node.
        """
        with pytest.raises(ValueError, match="must be a positive finite number"):
            ComponentSpec("bad-node", ComponentType.DATABASE, service_rate_rps=bad)

    def test_non_finite_error_names_the_node(self) -> None:
        with pytest.raises(ValueError, match="bad-node"):
            ComponentSpec(
                "bad-node", ComponentType.DATABASE, service_rate_rps=float("nan")
            )

    @pytest.mark.parametrize("bad", [-0.1, 1.1])
    def test_rejects_out_of_range_hit_ratio(self, bad: float) -> None:
        with pytest.raises(ValueError, match="hit ratio must be between 0 and 1"):
            ComponentSpec("n", ComponentType.CACHE, hit_ratio=bad)


class TestRegistry:
    def test_every_component_type_is_implemented(self) -> None:
        """Guards the open/closed promise: a new enum member needs a new class."""
        for component_type in ComponentType:
            component = build_component(spec(component_type))
            assert component.component_type is component_type

    def test_duplicate_registration_is_rejected(self) -> None:
        """Two classes claiming one type would silently shadow each other."""
        with pytest.raises(TypeError, match="already handled by"):

            class DuplicateCache(Component):
                component_type = ComponentType.CACHE

    def test_abstract_base_cannot_be_instantiated(self) -> None:
        """ABC alone does not block this, since Component has no abstractmethod."""
        with pytest.raises(TypeError, match="abstract"):
            Component(ComponentSpec("x", ComponentType.DATABASE))

    def test_subclass_without_type_is_rejected(self) -> None:
        with pytest.raises(TypeError, match="must define a component_type"):

            class Untyped(Component):
                pass
