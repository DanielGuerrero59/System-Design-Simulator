"""Pure M/M/1 queueing formulas.

This module knows nothing about graphs, components, replicas or the API layer.
It is deliberately just the math, so it can be unit tested in isolation and
checked line by line against a textbook.

Notation follows the standard queueing literature:

    lambda  (arrival_rate_rps)   requests arriving per second
    mu      (service_rate_rps)   requests ONE server completes per second
    rho     (utilization)        lambda / mu, the fraction of time busy

The M/M/1 model assumes Poisson arrivals, exponentially distributed service
times, a single server, and an unbounded FIFO queue. Real systems violate all
four to some degree. It remains the standard first approximation because it
captures the one behaviour that matters here: latency grows hyperbolically,
not linearly, as rho approaches 1.

Everything below is single-server. Modelling N replicas by splitting traffic
is the caller's job -- see the note on average_latency_seconds.

The last three functions leave steady state. They describe a *backlog*: the
requests that pile up while arrivals exceed capacity and are still waiting once
the rate drops back. M/M/1 has nothing to say about that (its queue has no
equilibrium at rho >= 1), so the backlog is modelled as a fluid -- a level that
rises at lambda - mu and drains at mu - lambda -- and laid on top of the
steady-state formulas. Every one of them reduces to plain M/M/1 when the
backlog is zero.
"""

from __future__ import annotations

import math

from .constants import BACKLOG_EMPTY_THRESHOLD_REQUESTS, UTILIZATION_SATURATED

__all__ = [
    "average_latency_seconds",
    "average_queue_length",
    "backlog_after",
    "backlog_wait_seconds",
    "effective_utilization",
    "is_stable",
    "utilization",
]


def _validate_rates(arrival_rate_rps: float, service_rate_rps: float) -> None:
    """Reject inputs for which the M/M/1 formulas are undefined.

    Raising rather than returning a sentinel: a negative arrival rate is a
    caller bug, not a system state the simulation should try to describe.
    """
    # isfinite rejects NaN and infinity together, and the NaN case matters most:
    # every comparison against NaN is False, so an unguarded NaN would slip past
    # a bare `< 0` check, poison rho, and then surface as a confident
    # "saturated" verdict rather than an error.
    if not math.isfinite(service_rate_rps) or service_rate_rps <= 0:
        raise ValueError(
            f"service rate must be a positive finite number, got {service_rate_rps}"
        )
    if not math.isfinite(arrival_rate_rps) or arrival_rate_rps < 0:
        raise ValueError(
            f"arrival rate must be a non-negative finite number, "
            f"got {arrival_rate_rps}"
        )


def utilization(arrival_rate_rps: float, service_rate_rps: float) -> float:
    """Return rho = lambda / mu, the fraction of time the server is busy.

    Values >= 1 mean arrivals meet or outpace service capacity. This is
    returned uncapped on purpose: a caller displaying rho = 3.0 is telling the
    user they are 3x over capacity, which is more useful than a clamped 1.0.
    """
    _validate_rates(arrival_rate_rps, service_rate_rps)
    return arrival_rate_rps / service_rate_rps


def is_stable(arrival_rate_rps: float, service_rate_rps: float) -> bool:
    """Whether the queue reaches a steady state rather than growing forever.

    At rho >= 1 the queue has no equilibrium: every formula below returns None
    rather than a very large number, because the honest answer is "unbounded",
    not "slow".
    """
    return utilization(arrival_rate_rps, service_rate_rps) < UTILIZATION_SATURATED


def average_latency_seconds(
    arrival_rate_rps: float, service_rate_rps: float
) -> float | None:
    """Average time one request spends here: queue wait PLUS service time.

        W = 1 / (mu - lambda)

    Returns None when saturated. Note the shape of this curve -- it is the
    whole point of the simulator. With mu = 1000, W is 2 ms at rho = 0.5 but
    100 ms at rho = 0.99: a 2x traffic increase near saturation costs 50x the
    latency.

    For N replicas, call this once with the traffic ONE replica sees
    (lambda / N), not with the total. Passing the aggregate rate N * mu would
    model a single N-times-faster server, which is a different and more
    optimistic system than N independent queues.
    """
    # Validated explicitly rather than relying on is_stable to do it. The guard
    # is load-bearing, and is_stable is one obvious refactor (dropping its
    # division for a direct comparison) away from no longer providing it.
    _validate_rates(arrival_rate_rps, service_rate_rps)

    if not is_stable(arrival_rate_rps, service_rate_rps):
        return None

    # Safe from division by zero: is_stable has already established
    # lambda < mu, and IEEE 754 subtraction of two distinct finite floats
    # never rounds to exactly zero.
    return 1.0 / (service_rate_rps - arrival_rate_rps)


def average_queue_length(
    arrival_rate_rps: float, service_rate_rps: float
) -> float | None:
    """Average number of requests at this component, waiting or in service.

    Little's Law: L = lambda * W. It holds for any stable queueing system
    regardless of arrival or service distribution, which makes it a useful
    independent check on the latency formula above rather than a restatement
    of it.

    Returns None when saturated, for the same reason as the latency formula.
    """
    latency_seconds = average_latency_seconds(arrival_rate_rps, service_rate_rps)
    if latency_seconds is None:
        return None
    return arrival_rate_rps * latency_seconds


def _validate_non_negative(name: str, value: float) -> None:
    # Same shape as _validate_rates, and for the same reason: NaN slips past a
    # bare comparison, and a NaN backlog would surface as a confident number.
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be a non-negative finite number, got {value}")


def backlog_after(
    backlog: float, arrival_rate_rps: float, service_rate_rps: float, seconds: float
) -> float:
    """Requests still queued beyond the steady state after `seconds` at these rates.

        B' = max(0, B + (lambda - mu) * t)

    A fluid queue. While lambda exceeds mu the excess piles up at lambda - mu
    per second; once lambda drops back under mu the pile drains at the spare
    capacity, mu - lambda, until it is gone. It never goes negative -- there is
    no such thing as a queue in credit -- and at exactly rho = 1 it neither
    grows nor drains.

    The update is linear in every argument, so it is exact on aggregate
    figures (N replicas' backlog against N * mu) as well as on one server's.

    A drain that reaches empty in exact arithmetic can land a hair above zero
    in floating point. Below BACKLOG_EMPTY_THRESHOLD_REQUESTS the pile is that
    residue rather than a queue, and is reported as empty so it cannot count
    as a second of recovery.
    """
    _validate_rates(arrival_rate_rps, service_rate_rps)
    _validate_non_negative("backlog", backlog)
    _validate_non_negative("seconds", seconds)

    remaining = backlog + (arrival_rate_rps - service_rate_rps) * seconds
    if remaining < BACKLOG_EMPTY_THRESHOLD_REQUESTS:
        return 0.0
    return remaining


def backlog_wait_seconds(backlog: float, service_rate_rps: float) -> float:
    """Time a request arriving now waits for the backlog ahead of it: B / mu.

    The server works through the pile at mu per second, and a FIFO queue means
    nothing that arrives later can jump ahead. Zero backlog, zero wait -- which
    is what keeps the steady-state numbers untouched when nothing has piled up.
    """
    _validate_rates(0.0, service_rate_rps)
    _validate_non_negative("backlog", backlog)
    return backlog / service_rate_rps


def effective_utilization(latency_seconds: float, service_rate_rps: float) -> float:
    """The rho at which a steady M/M/1 queue would have this latency.

        rho_eff = 1 - 1 / (mu * W)

    The inverse of average_latency_seconds: feed it W = 1 / (mu - lambda) and
    it returns lambda / mu exactly. Its purpose is to keep the status
    thresholds honest while a backlog drains. Those thresholds are stated as
    utilisations but were chosen for the latency multipliers they imply (see
    constants.py), and a component at rho = 0.6 with eight seconds of backlog
    ahead of it is not healthy. Classifying by the utilisation *implied by the
    latency* makes the backlog count, and changes nothing when there is none.

    Only defined for latencies at or above the idle service time 1 / mu, which
    is the least a request can spend here; a smaller value would come out
    negative and is not a state the model produces.
    """
    _validate_rates(0.0, service_rate_rps)
    if not math.isfinite(latency_seconds) or latency_seconds <= 0:
        raise ValueError(
            f"latency must be a positive finite number, got {latency_seconds}"
        )
    return 1.0 - 1.0 / (service_rate_rps * latency_seconds)
