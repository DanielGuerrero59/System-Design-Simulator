"""End-to-end tests for the graph engine: traffic propagation, paths, bad designs.

Expected latencies are written as explicit 1/(mu - lambda) expressions rather
than decimal literals. That keeps each number traceable to the formula and to a
hand-computed arrival rate, instead of being a value copied out of a test run.
"""

from __future__ import annotations

import pytest

from app.simulation.components import ComponentSpec
from app.simulation.constants import ComponentType, NodeStatus
from app.simulation.engine import SimulationError, simulate, simulate_timeline
from app.simulation.traffic import RampProfile, SpikeProfile, SteadyProfile, TrafficStep

LB = ComponentSpec("lb", ComponentType.LOAD_BALANCER)  # mu = 50_000
API = ComponentSpec("api", ComponentType.APP_SERVER)  # mu =  2_000
DB = ComponentSpec("db", ComponentType.DATABASE)  # mu =  5_000
CHAIN = [("lb", "api"), ("api", "db")]


def by_id(result, node_id: str):
    return next(node for node in result.nodes if node.node_id == node_id)


class TestSimpleChain:
    def test_known_values_for_lb_api_db(self) -> None:
        """The canonical design at 1500 rps, every number derived by hand."""
        result = simulate([LB, API, DB], CHAIN, 1_500.0)

        assert result.is_stable is True
        assert by_id(result, "lb").latency_seconds == pytest.approx(1 / (50_000 - 1_500))
        assert by_id(result, "api").latency_seconds == pytest.approx(1 / (2_000 - 1_500))
        assert by_id(result, "db").latency_seconds == pytest.approx(1 / (5_000 - 1_500))

    def test_total_is_the_sum_along_the_path(self) -> None:
        result = simulate([LB, API, DB], CHAIN, 1_500.0)
        expected = 1 / (50_000 - 1_500) + 1 / (2_000 - 1_500) + 1 / (5_000 - 1_500)
        assert result.total_latency_seconds == pytest.approx(expected)

    def test_traffic_reaches_every_node_undiminished(self) -> None:
        result = simulate([LB, API, DB], CHAIN, 1_500.0)
        assert [node.arrival_rate_rps for node in result.nodes] == [1_500.0] * 3

    def test_results_follow_caller_order_not_traversal_order(self) -> None:
        """The frontend zips these against its own node list, so order matters."""
        result = simulate([DB, API, LB], [("lb", "api"), ("api", "db")], 1_000.0)
        assert [node.node_id for node in result.nodes] == ["db", "api", "lb"]

    def test_entry_receives_traffic_even_when_listed_last(self) -> None:
        """Traffic must follow the graph's entry point, not the list's first item."""
        result = simulate([DB, API, LB], CHAIN, 1_500.0)
        assert by_id(result, "lb").arrival_rate_rps == pytest.approx(1_500.0)
        assert by_id(result, "db").arrival_rate_rps == pytest.approx(1_500.0)

    def test_bottleneck_is_highest_utilisation_not_slowest_rate(self) -> None:
        result = simulate([LB, API, DB], CHAIN, 1_500.0)
        assert result.bottleneck_node_id == "api"


class TestSaturation:
    def test_unstable_design_reports_no_total(self) -> None:
        result = simulate([LB, API, DB], CHAIN, 10_000.0)
        assert result.is_stable is False
        assert result.total_latency_seconds is None

    def test_saturated_node_reports_no_latency(self) -> None:
        result = simulate([LB, API, DB], CHAIN, 10_000.0)
        api = by_id(result, "api")
        assert api.status is NodeStatus.SATURATED
        assert api.latency_seconds is None
        assert api.utilization == pytest.approx(5.0)

    def test_healthy_nodes_still_reported_in_unstable_design(self) -> None:
        """A user needs to see which parts are fine, not just that it broke."""
        result = simulate([LB, API, DB], CHAIN, 10_000.0)
        assert by_id(result, "lb").status is NodeStatus.HEALTHY


class TestReplicasAndCache:
    def test_replicas_relieve_the_app_tier(self) -> None:
        scaled = ComponentSpec("api", ComponentType.APP_SERVER, replicas=8)
        result = simulate([LB, scaled, DB], CHAIN, 10_000.0)

        api = by_id(result, "api")
        assert api.utilization == pytest.approx(10_000 / (8 * 2_000))
        assert api.status is NodeStatus.HEALTHY
        # Scaling the app tier exposes the database as the next wall.
        assert result.bottleneck_node_id == "db"
        assert result.is_stable is False

    def test_cache_shields_the_database(self) -> None:
        """The payoff lesson: same traffic, one extra component, system holds."""
        scaled = ComponentSpec("api", ComponentType.APP_SERVER, replicas=8)
        cache = ComponentSpec("cache", ComponentType.CACHE, hit_ratio=0.9)
        result = simulate(
            [LB, scaled, cache, DB],
            [("lb", "api"), ("api", "cache"), ("cache", "db")],
            10_000.0,
        )

        assert result.is_stable is True
        assert by_id(result, "cache").arrival_rate_rps == pytest.approx(10_000.0)
        assert by_id(result, "db").arrival_rate_rps == pytest.approx(1_000.0)
        assert by_id(result, "db").latency_seconds == pytest.approx(
            1 / (5_000 - 1_000)
        )


class TestFanOut:
    def test_traffic_splits_evenly_across_outgoing_edges(self) -> None:
        servers = [
            ComponentSpec(name, ComponentType.APP_SERVER) for name in ("a", "b", "c")
        ]
        result = simulate(
            [LB, *servers],
            [("lb", "a"), ("lb", "b"), ("lb", "c")],
            5_400.0,
        )
        for name in ("a", "b", "c"):
            assert by_id(result, name).arrival_rate_rps == pytest.approx(1_800.0)

    def test_repeated_edge_does_not_halve_the_share(self) -> None:
        """A duplicated edge is the same connection, not two of them."""
        result = simulate([LB, API], [("lb", "api"), ("lb", "api")], 1_000.0)
        assert by_id(result, "api").arrival_rate_rps == pytest.approx(1_000.0)

    def test_converging_paths_sum_their_traffic(self) -> None:
        left = ComponentSpec("left", ComponentType.APP_SERVER)
        right = ComponentSpec("right", ComponentType.APP_SERVER)
        result = simulate(
            [LB, left, right, DB],
            [("lb", "left"), ("lb", "right"), ("left", "db"), ("right", "db")],
            1_000.0,
        )
        # 500 down each branch, recombining at the database.
        assert by_id(result, "db").arrival_rate_rps == pytest.approx(1_000.0)


class TestCriticalPath:
    def test_total_follows_the_slowest_branch(self) -> None:
        """Two parallel routes; a request takes one, so the slow one is the answer."""
        fast = ComponentSpec("fast", ComponentType.CACHE, hit_ratio=0.8)
        slow = ComponentSpec("slow", ComponentType.APP_SERVER)
        result = simulate(
            [LB, fast, slow, DB],
            [("lb", "fast"), ("lb", "slow"), ("fast", "db"), ("slow", "db")],
            1_000.0,
        )

        # lb passes 1000, split two ways -> 500 each.
        # fast is a cache at 80% hit, so it forwards 100; slow forwards 500.
        # The database therefore sees 600.
        expected = 1 / (50_000 - 1_000) + 1 / (2_000 - 500) + 1 / (5_000 - 600)
        assert result.total_latency_seconds == pytest.approx(expected)

    def test_single_node_design_is_its_own_path(self) -> None:
        result = simulate([API], [], 1_000.0)
        assert result.total_latency_seconds == pytest.approx(1 / (2_000 - 1_000))


class TestMalformedDesigns:
    def test_rejects_empty_design(self) -> None:
        with pytest.raises(SimulationError, match="no components"):
            simulate([], [], 100.0)

    def test_rejects_cycle(self) -> None:
        with pytest.raises(SimulationError, match="no entry point"):
            simulate([LB, API], [("lb", "api"), ("api", "lb")], 100.0)

    def test_rejects_cycle_downstream_of_a_valid_entry(self) -> None:
        loop_a = ComponentSpec("x", ComponentType.APP_SERVER)
        loop_b = ComponentSpec("y", ComponentType.APP_SERVER)
        with pytest.raises(SimulationError, match="contains a cycle"):
            simulate(
                [LB, loop_a, loop_b],
                [("lb", "x"), ("x", "y"), ("y", "x")],
                100.0,
            )

    def test_rejects_multiple_entry_points(self) -> None:
        with pytest.raises(SimulationError, match="more than one entry point"):
            simulate([LB, API, DB], [("lb", "db"), ("api", "db")], 100.0)

    def test_rejects_edge_to_unknown_node(self) -> None:
        with pytest.raises(SimulationError, match="unknown node"):
            simulate([LB, API], [("lb", "ghost")], 100.0)

    def test_rejects_duplicate_node_ids(self) -> None:
        with pytest.raises(SimulationError, match="duplicate node ids"):
            simulate([API, API], [], 100.0)

    @pytest.mark.parametrize("bad", [0.0, -1.0, float("nan"), float("inf")])
    def test_rejects_invalid_traffic(self, bad: float) -> None:
        with pytest.raises(SimulationError, match="positive finite rate"):
            simulate([API], [], bad)


class TestTimeline:
    """simulate_timeline: one steady state per sample, the design prepared once."""

    # Baseline 1,500 with a two-second burst to 2,500 at t = 2 and 3, in a
    # six-second window.
    SPIKE = SpikeProfile(
        baseline_rps=1_500.0,
        peak_rps=2_500.0,
        duration_seconds=6,
        peak_start_seconds=2,
        peak_seconds=2,
    )
    # 1,000 -> 3,000 over four seconds: 1,000, 1,500, 2,000, 2,500, 3,000.
    RAMP = RampProfile(start_rps=1_000.0, end_rps=3_000.0, duration_seconds=4)

    def test_time_axis_and_offered_rates_follow_the_profile(self) -> None:
        timeline = simulate_timeline([LB, API, DB], CHAIN, self.SPIKE.steps())
        assert [s.t_seconds for s in timeline.steps] == [0, 1, 2, 3, 4, 5, 6]
        assert [s.offered_rps for s in timeline.steps] == [
            1_500, 1_500, 2_500, 2_500, 1_500, 1_500, 1_500
        ]

    def test_baseline_samples_are_the_steady_state_at_1500(self) -> None:
        timeline = simulate_timeline([LB, API, DB], CHAIN, self.SPIKE.steps())
        expected_total = 1 / (50_000 - 1_500) + 1 / (2_000 - 1_500) + 1 / (5_000 - 1_500)
        for index in (0, 1, 4, 5, 6):
            result = timeline.steps[index].result
            assert result.is_stable is True
            assert by_id(result, "api").latency_seconds == pytest.approx(1 / (2_000 - 1_500))
            assert result.total_latency_seconds == pytest.approx(expected_total)

    def test_burst_samples_saturate_the_app_tier(self) -> None:
        timeline = simulate_timeline([LB, API, DB], CHAIN, self.SPIKE.steps())
        for index in (2, 3):
            result = timeline.steps[index].result
            assert result.is_stable is False
            assert result.total_latency_seconds is None
            api = by_id(result, "api")
            assert api.utilization == pytest.approx(2_500 / 2_000)
            assert api.latency_seconds is None
            # A healthy neighbour keeps its numbers while the app tier is down.
            assert by_id(result, "db").latency_seconds == pytest.approx(1 / (5_000 - 2_500))

    def test_worst_sample_is_the_first_second_of_the_burst(self) -> None:
        """Both burst seconds tie on utilisation; the earlier one is reported."""
        timeline = simulate_timeline([LB, API, DB], CHAIN, self.SPIKE.steps())
        assert timeline.worst_index == 2
        assert timeline.worst is timeline.steps[2].result
        assert timeline.saturated_steps == 2

    def test_ramp_crosses_saturation_at_exactly_rho_one(self) -> None:
        timeline = simulate_timeline([LB, API, DB], CHAIN, self.RAMP.steps())
        api_steps = [by_id(s.result, "api") for s in timeline.steps]

        assert [a.utilization for a in api_steps] == pytest.approx([0.5, 0.75, 1.0, 1.25, 1.5])
        assert api_steps[0].latency_seconds == pytest.approx(1 / (2_000 - 1_000))
        assert api_steps[1].latency_seconds == pytest.approx(1 / (2_000 - 1_500))
        # rho = 1.0 is already saturated: the boundary is >=, not >.
        assert [a.latency_seconds for a in api_steps[2:]] == [None, None, None]
        assert timeline.worst_index == 4
        assert timeline.saturated_steps == 3

    def test_each_sample_equals_the_single_rate_entry_point(self) -> None:
        """Independent check: simulate() is proven against hand values above."""
        timeline = simulate_timeline([LB, API, DB], CHAIN, self.RAMP.steps())
        for step in timeline.steps:
            assert step.result == simulate([LB, API, DB], CHAIN, step.offered_rps)

    def test_steady_profile_is_one_sample_and_is_simulate(self) -> None:
        timeline = simulate_timeline([LB, API, DB], CHAIN, SteadyProfile(1_500.0).steps())
        assert len(timeline.steps) == 1
        assert timeline.worst_index == 0
        assert timeline.saturated_steps == 0
        assert timeline.worst == simulate([LB, API, DB], CHAIN, 1_500.0)

    def test_rejects_empty_timeline(self) -> None:
        with pytest.raises(SimulationError, match="no steps"):
            simulate_timeline([API], [], [])

    def test_rejects_invalid_step_rate(self) -> None:
        with pytest.raises(SimulationError, match="positive finite rate"):
            simulate_timeline(
                [API], [], [TrafficStep(0.0, 1_000.0), TrafficStep(1.0, float("nan"))]
            )

    def test_design_is_validated_before_any_sample_runs(self) -> None:
        """A cycle is reported even though the only step would also be invalid."""
        with pytest.raises(SimulationError, match="no entry point"):
            simulate_timeline(
                [LB, API], [("lb", "api"), ("api", "lb")], [TrafficStep(0.0, float("nan"))]
            )
