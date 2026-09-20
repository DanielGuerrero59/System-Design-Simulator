"""Unit tests for the M/M/1 formulas.

These are the highest-value tests in the project: every latency number the app
ever shows is derived from this handful of functions, and a wrong formula still
returns a plausible-looking float. Cases below are hand-computed from the
textbook definitions rather than recorded from the implementation, so they fail
if the implementation drifts.
"""

from __future__ import annotations

import pytest

from app.simulation.queueing import (
    average_latency_seconds,
    average_queue_length,
    backlog_after,
    backlog_wait_seconds,
    effective_utilization,
    is_stable,
    utilization,
)

# A round service rate makes the hand-computed expectations easy to verify:
# mu = 1000 rps means the idle service time is exactly 1 ms.
MU = 1000.0


class TestUtilization:
    @pytest.mark.parametrize(
        ("arrival_rate", "expected_rho"),
        [
            (0.0, 0.0),
            (500.0, 0.5),
            (900.0, 0.9),
            (1000.0, 1.0),
            (3000.0, 3.0),  # over capacity is reported uncapped, not clamped
        ],
    )
    def test_known_values(self, arrival_rate: float, expected_rho: float) -> None:
        assert utilization(arrival_rate, MU) == pytest.approx(expected_rho)

    def test_rejects_zero_service_rate(self) -> None:
        with pytest.raises(ValueError, match="service rate must be a positive finite number"):
            utilization(100.0, 0.0)

    def test_rejects_negative_service_rate(self) -> None:
        with pytest.raises(ValueError, match="service rate must be a positive finite number"):
            utilization(100.0, -1.0)

    def test_rejects_negative_arrival_rate(self) -> None:
        with pytest.raises(ValueError, match="arrival rate must be a non-negative finite number"):
            utilization(-1.0, MU)

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    def test_rejects_non_finite_arrival_rate(self, bad: float) -> None:
        """NaN is the dangerous one: every comparison against it is False, so an
        unguarded NaN reads as 'saturated' rather than as bad input."""
        with pytest.raises(ValueError, match="arrival rate must be"):
            utilization(bad, MU)

    @pytest.mark.parametrize("bad", [float("nan"), float("inf")])
    def test_rejects_non_finite_service_rate(self, bad: float) -> None:
        with pytest.raises(ValueError, match="service rate must be"):
            utilization(100.0, bad)


class TestIsStable:
    @pytest.mark.parametrize(
        ("arrival_rate", "expected"),
        [
            (0.0, True),
            (999.0, True),
            (999.999, True),
            (1000.0, False),  # rho exactly 1.0 is unstable, not borderline-ok
            (1000.001, False),
            (5000.0, False),
        ],
    )
    def test_boundary(self, arrival_rate: float, expected: bool) -> None:
        assert is_stable(arrival_rate, MU) is expected

    def test_rejects_invalid_rates(self) -> None:
        with pytest.raises(ValueError, match="service rate must be"):
            is_stable(100.0, 0.0)
        with pytest.raises(ValueError, match="arrival rate must be"):
            is_stable(-1.0, MU)

    def test_nan_is_rejected_not_treated_as_saturated(self) -> None:
        with pytest.raises(ValueError, match="arrival rate must be"):
            is_stable(float("nan"), MU)


class TestAverageLatency:
    @pytest.mark.parametrize(
        ("arrival_rate", "expected_seconds"),
        [
            (0.0, 0.001),  # idle: pure service time, 1 ms, no queueing
            (500.0, 0.002),  # rho 0.50 ->   2x idle
            (800.0, 0.005),  # rho 0.80 ->   5x idle
            (900.0, 0.010),  # rho 0.90 ->  10x idle
            (990.0, 0.100),  # rho 0.99 -> 100x idle
        ],
    )
    def test_known_values(self, arrival_rate: float, expected_seconds: float) -> None:
        assert average_latency_seconds(arrival_rate, MU) == pytest.approx(
            expected_seconds
        )

    @pytest.mark.parametrize("arrival_rate", [1000.0, 1000.001, 2000.0])
    def test_saturated_returns_none(self, arrival_rate: float) -> None:
        """Unbounded latency must be None, never a large float or infinity."""
        assert average_latency_seconds(arrival_rate, MU) is None

    def test_growth_is_hyperbolic_not_linear(self) -> None:
        """The core lesson of the simulator, asserted directly.

        Doubling traffic from 495 to 990 rps multiplies latency by 50.5x, not 2x:
        W goes from 1/505 s to 1/10 s.
        """
        half = average_latency_seconds(495.0, MU)
        double = average_latency_seconds(990.0, MU)
        assert half is not None and double is not None
        assert double / half == pytest.approx(50.5)

    def test_rejects_invalid_rates(self) -> None:
        """Messages are pinned so an unrelated ValueError cannot satisfy this."""
        with pytest.raises(ValueError, match="service rate must be a positive finite number"):
            average_latency_seconds(100.0, 0.0)
        with pytest.raises(ValueError, match="arrival rate must be a non-negative finite number"):
            average_latency_seconds(-1.0, MU)
        with pytest.raises(ValueError, match="arrival rate must be"):
            average_latency_seconds(float("nan"), MU)

    def test_near_saturation_is_finite_but_extreme(self) -> None:
        """Pin the rho -> 1 regime, where latency is finite yet meaningless.

        At rho = 0.9999999 the model reports ~10,000 seconds and still calls the
        system stable. That is arithmetically correct, and it is the reason the
        UI must lead with utilisation rather than a raw latency number.
        """
        latency = average_latency_seconds(999.9999, MU)
        assert latency is not None
        assert latency == pytest.approx(10_000.0, rel=1e-6)
        assert is_stable(999.9999, MU) is True


class TestAverageQueueLength:
    @pytest.mark.parametrize(
        ("arrival_rate", "expected_length"),
        [
            (0.0, 0.0),
            (500.0, 1.0),
            (800.0, 4.0),
            (900.0, 9.0),
        ],
    )
    def test_matches_rho_over_one_minus_rho(
        self, arrival_rate: float, expected_length: float
    ) -> None:
        """Cross-check against L = rho / (1 - rho).

        That identity is derived independently of L = lambda * W, so agreement
        between the two is real evidence the latency formula is right and not
        just self-consistent.
        """
        assert average_queue_length(arrival_rate, MU) == pytest.approx(
            expected_length
        )

    def test_satisfies_littles_law(self) -> None:
        """L = lambda * W, stated explicitly rather than implied by the values."""
        arrival_rate = 750.0
        latency = average_latency_seconds(arrival_rate, MU)
        assert latency is not None
        assert average_queue_length(arrival_rate, MU) == pytest.approx(
            arrival_rate * latency
        )

    @pytest.mark.parametrize("arrival_rate", [1000.0, 4000.0])
    def test_saturated_returns_none(self, arrival_rate: float) -> None:
        assert average_queue_length(arrival_rate, MU) is None


class TestBacklogAfter:
    """B' = max(0, B + (lambda - mu) * t), worked by hand at mu = 1000."""

    @pytest.mark.parametrize(
        ("backlog", "arrival_rate", "seconds", "expected"),
        [
            (0.0, 1500.0, 1.0, 500.0),  # 500 over capacity for one second
            (500.0, 1500.0, 1.0, 1000.0),  # and the pile keeps growing
            (1000.0, 500.0, 1.0, 500.0),  # drains at the spare 500 rps
            (1000.0, 500.0, 2.0, 0.0),  # exactly empty after two seconds
            (300.0, 500.0, 1.0, 0.0),  # would go negative: clamped, not owed
            (700.0, 1000.0, 5.0, 700.0),  # rho = 1: neither grows nor drains
            (0.0, 500.0, 1.0, 0.0),  # under capacity with nothing queued stays empty
        ],
    )
    def test_known_values(
        self, backlog: float, arrival_rate: float, seconds: float, expected: float
    ) -> None:
        assert backlog_after(backlog, arrival_rate, MU, seconds) == pytest.approx(expected)

    def test_is_linear_so_aggregate_and_per_replica_agree(self) -> None:
        """Two replicas at mu 2,000 sharing 3,000 rps and a 1,000-request pile.

        Aggregate: 1,000 + (3,000 - 4,000) * 0.5 = 500. Per replica: 500 +
        (1,500 - 2,000) * 0.5 = 250, and two of those make the same 500.
        """
        aggregate = backlog_after(1000.0, 3000.0, 4000.0, 0.5)
        per_replica = backlog_after(500.0, 1500.0, 2000.0, 0.5)
        assert aggregate == pytest.approx(500.0)
        assert 2 * per_replica == pytest.approx(aggregate)

    def test_float_residue_reads_as_empty(self) -> None:
        """0.1 + 0.2 is 0.30000000000000004; draining 0.3 leaves ~5e-17, not a queue."""
        assert backlog_after(0.1 + 0.2, 0.0, 0.3, 1.0) == 0.0

    def test_a_real_fraction_of_a_request_is_kept(self) -> None:
        """The floor is for rounding residue only: a genuine half request survives."""
        assert backlog_after(1.0, 500.0, MU, 0.001) == pytest.approx(0.5)

    def test_rejects_invalid_inputs(self) -> None:
        with pytest.raises(ValueError, match="backlog must be a non-negative finite number"):
            backlog_after(-1.0, 500.0, MU, 1.0)
        with pytest.raises(ValueError, match="backlog must be"):
            backlog_after(float("nan"), 500.0, MU, 1.0)
        with pytest.raises(ValueError, match="seconds must be a non-negative finite number"):
            backlog_after(0.0, 500.0, MU, -1.0)
        with pytest.raises(ValueError, match="seconds must be"):
            backlog_after(0.0, 500.0, MU, float("inf"))
        with pytest.raises(ValueError, match="service rate must be"):
            backlog_after(0.0, 500.0, 0.0, 1.0)
        with pytest.raises(ValueError, match="arrival rate must be"):
            backlog_after(0.0, -1.0, MU, 1.0)


class TestBacklogWait:
    @pytest.mark.parametrize(
        ("backlog", "service_rate", "expected_seconds"),
        [
            (0.0, MU, 0.0),  # nothing queued, nothing to wait for
            (1000.0, 2000.0, 0.5),
            (40_000.0, 5000.0, 8.0),  # a ten-second burst 4,000 rps over a database
        ],
    )
    def test_known_values(
        self, backlog: float, service_rate: float, expected_seconds: float
    ) -> None:
        assert backlog_wait_seconds(backlog, service_rate) == pytest.approx(expected_seconds)

    def test_rejects_invalid_inputs(self) -> None:
        with pytest.raises(ValueError, match="backlog must be"):
            backlog_wait_seconds(-1.0, MU)
        with pytest.raises(ValueError, match="service rate must be"):
            backlog_wait_seconds(10.0, 0.0)


class TestEffectiveUtilization:
    @pytest.mark.parametrize("arrival_rate", [0.0, 500.0, 900.0, 990.0])
    def test_inverts_the_latency_formula(self, arrival_rate: float) -> None:
        """Round trip: the rho implied by W(lambda) is lambda / mu.

        An identity between two functions, so agreement is evidence about
        both rather than a restatement of either one's arithmetic.
        """
        latency = average_latency_seconds(arrival_rate, MU)
        assert latency is not None
        assert effective_utilization(latency, MU) == pytest.approx(arrival_rate / MU)

    def test_idle_service_time_is_zero_utilisation(self) -> None:
        """1 ms at mu 1000 is the least a request can spend here: nothing queued."""
        assert effective_utilization(0.001, MU) == pytest.approx(0.0)

    def test_a_backlog_reads_as_a_busier_queue(self) -> None:
        """mu 2,000 at rho 0.75 with 1,000 requests queued ahead.

        W = 1/(2,000 - 1,500) + 1,000/2,000 = 0.502 s, so
        rho_eff = 1 - 1/(2,000 * 0.502) = 1 - 1/1,004: deep in the critical
        band although the offered load alone would be a warning.
        """
        assert effective_utilization(0.502, 2000.0) == pytest.approx(1 - 1 / 1004)

    def test_stays_below_saturation_for_any_finite_latency(self) -> None:
        """A draining queue is slow, not unbounded: rho_eff < 1 however deep it is."""
        assert effective_utilization(1e6, MU) < 1.0

    def test_rejects_invalid_inputs(self) -> None:
        with pytest.raises(ValueError, match="latency must be a positive finite number"):
            effective_utilization(0.0, MU)
        with pytest.raises(ValueError, match="latency must be"):
            effective_utilization(float("nan"), MU)
        with pytest.raises(ValueError, match="service rate must be"):
            effective_utilization(0.001, 0.0)
