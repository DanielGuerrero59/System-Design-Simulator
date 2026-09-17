"""Traffic profiles: the offered load as a function of time.

queueing.py answers "what happens at one rate?"; this module answers "which
rates, and when?". A profile expands into a list of (time, rate) steps and the
engine evaluates each step as its own steady state.

That quasi-static view is a deliberate simplification, and it errs on the
forgiving side: no queue carries over from one second to the next, so a burst's
damage ends the moment the burst does, where a real queue would take time to
drain. Carrying backlog forward is the planned next step, and it will be a
change to the engine rather than to this module -- the list of steps is the
seam between "what load arrives" and "what the system does with it".

Like the rest of the simulation package, nothing here imports FastAPI or
Pydantic. The API layer converts its models into the dataclasses below, which
re-check their inputs because this package is importable on its own.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass

from .constants import MAX_TIMELINE_STEPS, TIMELINE_STEP_SECONDS

__all__ = [
    "RampProfile",
    "SpikeProfile",
    "SteadyProfile",
    "TrafficProfile",
    "TrafficStep",
]


@dataclass(frozen=True)
class TrafficStep:
    """The offered rate at one instant of the timeline."""

    t_seconds: float
    rps: float


def _validate_rate(name: str, value: float) -> None:
    # isfinite, not a bare comparison: NaN compares False against everything,
    # so `value <= 0` alone would wave it through to poison every step.
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive finite rate, got {value}")


def _validate_seconds(name: str, value: int, *, minimum: int) -> None:
    # Whole seconds only. A float here would silently break the sampling loop
    # below, and one sample per second is the resolution the model promises.
    if not isinstance(value, int) or value < minimum:
        raise ValueError(
            f"{name} must be a whole number of seconds >= {minimum}, got {value!r}"
        )


def _sample(rate_at: Callable[[int], float], duration_seconds: int) -> list[TrafficStep]:
    """Evaluate rate_at once per TIMELINE_STEP_SECONDS from 0 to the end, inclusive.

    Inclusive at both ends so a ramp's final step is exactly its end rate rather
    than one sample short of it.
    """
    count = duration_seconds // TIMELINE_STEP_SECONDS + 1
    if count > MAX_TIMELINE_STEPS:
        raise ValueError(
            f"a {duration_seconds}s window is {count} samples; "
            f"the limit is {MAX_TIMELINE_STEPS}"
        )
    return [
        TrafficStep(t_seconds=float(t), rps=rate_at(t))
        for t in range(0, duration_seconds + 1, TIMELINE_STEP_SECONDS)
    ]


class TrafficProfile(ABC):
    """Anything that can expand into a timeline of steps."""

    @abstractmethod
    def steps(self) -> list[TrafficStep]:
        """The offered rate at each sample, in time order. Never empty."""


@dataclass(frozen=True)
class SteadyProfile(TrafficProfile):
    """One rate, held indefinitely.

    A single step: time does not enter into a steady state, so sampling it
    repeatedly would only repeat one number. This is the whole of the original
    model, kept as the default shape.
    """

    requests_per_second: float

    def __post_init__(self) -> None:
        _validate_rate("requests_per_second", self.requests_per_second)

    def steps(self) -> list[TrafficStep]:
        return [TrafficStep(t_seconds=0.0, rps=self.requests_per_second)]


@dataclass(frozen=True)
class SpikeProfile(TrafficProfile):
    """A baseline with one rectangular burst.

    The burst is the half-open window [peak_start, peak_start + peak_seconds):
    a ten-second burst occupies exactly ten samples, and the second it ends is
    already back at baseline.
    """

    baseline_rps: float
    peak_rps: float
    duration_seconds: int
    peak_start_seconds: int
    peak_seconds: int

    def __post_init__(self) -> None:
        _validate_rate("baseline_rps", self.baseline_rps)
        _validate_rate("peak_rps", self.peak_rps)
        _validate_seconds("duration_seconds", self.duration_seconds, minimum=1)
        _validate_seconds("peak_start_seconds", self.peak_start_seconds, minimum=0)
        _validate_seconds("peak_seconds", self.peak_seconds, minimum=1)
        # A "peak" at or below the baseline is not a spike, and reporting it as
        # one would mislabel every number downstream.
        if self.peak_rps <= self.baseline_rps:
            raise ValueError(
                f"a spike's peak_rps must exceed its baseline_rps, got peak "
                f"{self.peak_rps} against baseline {self.baseline_rps}"
            )
        burst_end = self.peak_start_seconds + self.peak_seconds
        if burst_end > self.duration_seconds:
            raise ValueError(
                f"the burst ends at {burst_end}s, after the "
                f"{self.duration_seconds}s window"
            )

    def rate_at(self, t_seconds: int) -> float:
        in_burst = (
            self.peak_start_seconds
            <= t_seconds
            < self.peak_start_seconds + self.peak_seconds
        )
        return self.peak_rps if in_burst else self.baseline_rps

    def steps(self) -> list[TrafficStep]:
        return _sample(self.rate_at, self.duration_seconds)


@dataclass(frozen=True)
class RampProfile(TrafficProfile):
    """A straight line from start_rps at t = 0 to end_rps at t = duration.

    Downward ramps are allowed; the shape is the same line. Interpolated as
    start * (1 - f) + end * f rather than start + (end - start) * f, so that
    f = 1 yields end_rps exactly instead of a float one rounding away from it --
    the last sample is the one a level's target will be checked against.
    """

    start_rps: float
    end_rps: float
    duration_seconds: int

    def __post_init__(self) -> None:
        _validate_rate("start_rps", self.start_rps)
        _validate_rate("end_rps", self.end_rps)
        _validate_seconds("duration_seconds", self.duration_seconds, minimum=1)

    def rate_at(self, t_seconds: int) -> float:
        fraction = t_seconds / self.duration_seconds
        return self.start_rps * (1.0 - fraction) + self.end_rps * fraction

    def steps(self) -> list[TrafficStep]:
        return _sample(self.rate_at, self.duration_seconds)
