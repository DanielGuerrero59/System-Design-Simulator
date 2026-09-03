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
