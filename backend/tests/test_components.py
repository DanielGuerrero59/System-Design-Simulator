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


class TestBacklog:
    """A queue left over from an earlier second, handed in by the engine."""

    def test_zero_backlog_is_the_plain_mm1_figure(self) -> None:
        """mu 1,000 at 500 rps: rho 0.5, W 2 ms, and nothing queued to report."""
        analysis = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=1_000.0)
        ).analyze(500.0)
        assert analysis.backlog == 0.0
        assert analysis.latency_seconds == pytest.approx(0.002)
        assert analysis.effective_utilization == pytest.approx(analysis.utilization)
        assert analysis.status is NodeStatus.HEALTHY

    def test_backlog_adds_its_drain_time_to_the_latency(self) -> None:
        """mu 2,000 at 1,500 rps with 1,000 requests already queued.

        Steady state is 1/(2,000 - 1,500) = 2 ms; the pile takes 1,000/2,000 =
        0.5 s to clear, so a request spends 0.502 s. The offered load is still
        rho 0.75 -- a warning on its own -- but the queue makes it critical:
        rho_eff = 1 - 1/(2,000 * 0.502) = 1 - 1/1,004.
        """
        analysis = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=2_000.0)
        ).analyze(1_500.0, backlog=1_000.0)
        assert analysis.latency_seconds == pytest.approx(0.502)
        assert analysis.utilization == pytest.approx(0.75)
        assert analysis.effective_utilization == pytest.approx(1 - 1 / 1_004)
        assert analysis.status is NodeStatus.CRITICAL
        assert analysis.backlog == 1_000.0

    def test_replicas_share_the_backlog_as_they_share_the_traffic(self) -> None:
        """Two replicas at mu 2,000, 3,000 rps and a 1,000-request pile.

        Each sees 1,500 rps and 500 queued: 2 ms steady state plus 500/2,000 =
        0.25 s of drain. The backlog is reported as the user-facing aggregate.
        """
        analysis = build_component(
            spec(ComponentType.APP_SERVER, replicas=2, service_rate_rps=2_000.0)
        ).analyze(3_000.0, backlog=1_000.0)
        assert analysis.latency_seconds == pytest.approx(0.252)
        assert analysis.backlog == 1_000.0

    @pytest.mark.parametrize(
        ("backlog", "expected_effective", "expected_status"),
        [
            (0.0, 0.5, NodeStatus.HEALTHY),
            (0.5, 0.6, NodeStatus.HEALTHY),  # W = 2 ms + 0.5 ms; 1 - 1/2.5
            (2.0, 0.75, NodeStatus.WARNING),  # W = 2 ms + 2 ms; 1 - 1/4
            (10.0, 1 - 1 / 12, NodeStatus.CRITICAL),  # W = 2 ms + 10 ms
        ],
    )
    def test_status_follows_the_queue_not_the_rate(
        self, backlog: float, expected_effective: float, expected_status: NodeStatus
    ) -> None:
        """mu 1,000 at 500 rps is rho 0.5 whatever is queued; the status is not."""
        analysis = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=1_000.0)
        ).analyze(500.0, backlog=backlog)
        assert analysis.utilization == pytest.approx(0.5)
        assert analysis.effective_utilization == pytest.approx(expected_effective)
        assert analysis.status is expected_status

    def test_saturated_reports_the_backlog_but_still_no_latency(self) -> None:
        """Over capacity there is no steady state to add a drain time to."""
        analysis = build_component(
            spec(ComponentType.APP_SERVER, service_rate_rps=1_000.0)
        ).analyze(1_500.0, backlog=700.0)
        assert analysis.latency_seconds is None
        assert analysis.status is NodeStatus.SATURATED
        assert analysis.backlog == 700.0
        # The offered load stays the measure of how far over capacity it is.
        assert analysis.effective_utilization == pytest.approx(1.5)

    def test_backlog_changes_the_wait_not_what_continues_downstream(self) -> None:
        analysis = build_component(spec(ComponentType.CACHE)).analyze(
            1_000.0, backlog=50.0
        )
        assert analysis.downstream_rate_rps == pytest.approx(
            1_000.0 * (1 - DEFAULT_CACHE_HIT_RATIO)
        )

    @pytest.mark.parametrize("bad", [-1.0, float("nan"), float("inf")])
    def test_rejects_an_impossible_backlog(self, bad: float) -> None:
        with pytest.raises(ValueError, match="backlog must be a non-negative finite number"):
            build_component(spec(ComponentType.APP_SERVER)).analyze(500.0, backlog=bad)


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
