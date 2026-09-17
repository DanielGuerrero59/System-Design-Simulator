"""Tests for traffic profiles: the expansion of a shape into per-second steps.

Every expected series is written out in full, so each value can be checked by
eye against the profile's definition rather than against what the code printed.
"""

from __future__ import annotations

import math

import pytest

from app.simulation.constants import MAX_TIMELINE_STEPS
from app.simulation.traffic import (
    RampProfile,
    SpikeProfile,
    SteadyProfile,
    TrafficProfile,
    TrafficStep,
)


def rates(profile: TrafficProfile) -> list[float]:
    return [step.rps for step in profile.steps()]


def times(profile: TrafficProfile) -> list[float]:
    return [step.t_seconds for step in profile.steps()]


class TestSteady:
    def test_is_a_single_step_at_time_zero(self) -> None:
        assert SteadyProfile(1_500.0).steps() == [TrafficStep(0.0, 1_500.0)]

    @pytest.mark.parametrize("bad", [0.0, -1.0, math.inf, math.nan])
    def test_rejects_invalid_rate(self, bad: float) -> None:
        with pytest.raises(ValueError, match="requests_per_second"):
            SteadyProfile(bad)


class TestSpike:
    # Baseline 1,500 with a two-second burst to 2,500 starting at t = 2, in a
    # six-second window.
    SPIKE = SpikeProfile(
        baseline_rps=1_500.0,
        peak_rps=2_500.0,
        duration_seconds=6,
        peak_start_seconds=2,
        peak_seconds=2,
    )

    def test_one_sample_per_second_inclusive_of_both_ends(self) -> None:
        assert times(self.SPIKE) == [0, 1, 2, 3, 4, 5, 6]

    def test_burst_window_is_half_open(self) -> None:
        """t = 2 and t = 3 are the burst; t = 4 is already back at baseline."""
        assert rates(self.SPIKE) == [1_500, 1_500, 2_500, 2_500, 1_500, 1_500, 1_500]

    def test_burst_may_start_at_zero(self) -> None:
        profile = SpikeProfile(1_000.0, 2_000.0, duration_seconds=3, peak_start_seconds=0, peak_seconds=1)
        assert rates(profile) == [2_000, 1_000, 1_000, 1_000]

    def test_burst_may_end_exactly_at_the_window_end(self) -> None:
        """start + length == duration is allowed; the final sample is baseline."""
        profile = SpikeProfile(1_000.0, 2_000.0, duration_seconds=3, peak_start_seconds=1, peak_seconds=2)
        assert rates(profile) == [1_000, 2_000, 2_000, 1_000]

    @pytest.mark.parametrize("peak", [1_500.0, 1_499.0])
    def test_rejects_peak_not_above_baseline(self, peak: float) -> None:
        with pytest.raises(ValueError, match="peak_rps must exceed"):
            SpikeProfile(1_500.0, peak, duration_seconds=6, peak_start_seconds=2, peak_seconds=2)

    def test_rejects_burst_overflowing_the_window(self) -> None:
        with pytest.raises(ValueError, match="after the 6s window"):
            SpikeProfile(1_500.0, 2_500.0, duration_seconds=6, peak_start_seconds=5, peak_seconds=2)

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("baseline_rps", math.nan),
            ("peak_rps", math.inf),
            ("duration_seconds", 0),
            ("duration_seconds", 6.0),
            ("peak_start_seconds", -1),
            ("peak_seconds", 0),
        ],
    )
    def test_rejects_invalid_rates_and_durations(self, field: str, value: object) -> None:
        kwargs: dict[str, object] = {
            "baseline_rps": 1_500.0,
            "peak_rps": 2_500.0,
            "duration_seconds": 6,
            "peak_start_seconds": 2,
            "peak_seconds": 2,
        }
        kwargs[field] = value
        with pytest.raises(ValueError, match=field):
            SpikeProfile(**kwargs)  # type: ignore[arg-type]


class TestRamp:
    RAMP = RampProfile(start_rps=1_000.0, end_rps=3_000.0, duration_seconds=4)

    def test_linear_series(self) -> None:
        assert rates(self.RAMP) == [1_000, 1_500, 2_000, 2_500, 3_000]
        assert times(self.RAMP) == [0, 1, 2, 3, 4]

    @pytest.mark.parametrize(
        ("start", "end", "duration"),
        [(1_000.1, 3_000.7, 7), (0.1, 0.3, 3), (2_400.0, 7_200.0, 60)],
    )
    def test_endpoints_are_exact(self, start: float, end: float, duration: int) -> None:
        """Exact equality on purpose: the last sample is what a target is checked against."""
        steps = RampProfile(start, end, duration).steps()
        assert steps[0].rps == start
        assert steps[-1].rps == end

    def test_ramp_down_is_allowed(self) -> None:
        assert rates(RampProfile(3_000.0, 1_000.0, 2)) == [3_000, 2_000, 1_000]

    @pytest.mark.parametrize(
        ("field", "value"),
        [("start_rps", 0.0), ("end_rps", math.nan), ("duration_seconds", 0), ("duration_seconds", 4.0)],
    )
    def test_rejects_invalid_rates_and_durations(self, field: str, value: object) -> None:
        kwargs: dict[str, object] = {"start_rps": 1_000.0, "end_rps": 3_000.0, "duration_seconds": 4}
        kwargs[field] = value
        with pytest.raises(ValueError, match=field):
            RampProfile(**kwargs)  # type: ignore[arg-type]


class TestSampleCeiling:
    def test_longest_allowed_window_fits_exactly(self) -> None:
        # duration + 1 samples (both ends inclusive), so MAX - 1 seconds is the
        # longest window that fits under the ceiling.
        assert len(RampProfile(1.0, 2.0, MAX_TIMELINE_STEPS - 1).steps()) == MAX_TIMELINE_STEPS

    def test_one_second_longer_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=f"limit is {MAX_TIMELINE_STEPS}"):
            RampProfile(1.0, 2.0, MAX_TIMELINE_STEPS).steps()
