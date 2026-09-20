"""FastAPI application: the only module in the project that knows about HTTP.

Its whole job is translation. Pydantic models come in, get converted into the
framework-free types the engine understands, and the engine's result is
converted back. No simulation logic lives here, which is what keeps the engine
testable without a server.
"""

from __future__ import annotations

import math
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .schemas import (
    NodeResult,
    RampTraffic,
    SimulationRequest,
    SimulationResponse,
    SpikeTraffic,
    SteadyTraffic,
    StepResult,
    TimelineStep,
    TrafficSummary,
)
from .simulation.components import ComponentSpec
from .simulation.constants import (
    MILLISECONDS_PER_SECOND,
    TIMELINE_STEP_SECONDS,
    TrafficKind,
)
from .simulation.engine import (
    SimulationError,
    SimulationResult,
    TimelineResult,
    simulate_timeline,
)
from .simulation.traffic import (
    RampProfile,
    SpikeProfile,
    SteadyProfile,
    TrafficProfile,
)

# The React dev server, on both common ports (Vite and Create React App).
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def _allowed_origins() -> list[str]:
    """Read CORS origins from the environment, falling back to local dev.

    Deployment has to add the frontend's real origin. Keeping that in an env var
    rather than in this list means shipping the frontend does not require
    editing and redeploying the backend -- and a missing origin is the worst
    kind of bug to chase, since curl and the test suite both keep passing while
    only the browser fails.

    Set ALLOWED_ORIGINS to a comma-separated list, e.g.
        ALLOWED_ORIGINS=https://my-app.vercel.app
    """
    configured = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not configured:
        return DEFAULT_ALLOWED_ORIGINS
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


ALLOWED_ORIGINS = _allowed_origins()

app = FastAPI(
    title="System Design Simulator",
    description=(
        "Simulates a distributed system design using M/M/1 queueing theory and "
        "reports per-component latency, utilisation and bottlenecks."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def _json_safe(value: Any) -> Any:
    """Replace non-finite floats with their names, recursively.

    FastAPI's default validation-error handler echoes the rejected input back to
    the caller. When that input is Infinity or NaN, json.dumps refuses to encode
    it and raises inside the error handler itself -- so a request that Pydantic
    correctly rejected surfaces as an unhandled 500 instead of a clean 422.

    Infinity and NaN are not valid JSON, but Python's parser accepts the bare
    tokens, so they genuinely arrive over the wire and this path is reachable.
    """
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return FastAPI's usual 422 body, with non-serialisable inputs made safe.

    jsonable_encoder first, exactly as FastAPI's own handler does: a validator
    that raises ValueError embeds the exception object itself in the error's
    ctx, and only the encoder knows how to turn that into a string. _json_safe
    then handles the case the encoder still leaves unserialisable -- inf and nan
    floats, which it passes through untouched.
    """
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": _json_safe(jsonable_encoder(exc.errors()))},
    )


def _to_milliseconds(seconds: float | None) -> float | None:
    """Convert to the API's unit, preserving None.

    None means saturated, and it has to survive the conversion intact -- a
    saturated component must never come out the other side as 0.0.
    """
    if seconds is None:
        return None
    return seconds * MILLISECONDS_PER_SECOND


def _to_profile(traffic: SteadyTraffic | SpikeTraffic | RampTraffic) -> TrafficProfile:
    """Map the API's description of the load onto the engine's.

    Plain isinstance dispatch rather than a registry: a new shape is a new
    schema *and* a new profile by definition, so the mapping between them is
    part of the contract change rather than something to hide behind one.
    """
    if isinstance(traffic, SteadyTraffic):
        return SteadyProfile(requests_per_second=traffic.requests_per_second)
    if isinstance(traffic, SpikeTraffic):
        return SpikeProfile(
            baseline_rps=traffic.baseline_rps,
            peak_rps=traffic.peak_rps,
            duration_seconds=traffic.duration_seconds,
            peak_start_seconds=traffic.peak_start_seconds,
            peak_seconds=traffic.peak_seconds,
        )
    return RampProfile(
        start_rps=traffic.start_rps,
        end_rps=traffic.end_rps,
        duration_seconds=traffic.duration_seconds,
    )


def _to_step_result(result: SimulationResult) -> StepResult:
    """Map the engine's framework-free result for one rate onto the wire format."""
    return StepResult(
        is_stable=result.is_stable,
        total_latency_ms=_to_milliseconds(result.total_latency_seconds),
        bottleneck_node_id=result.bottleneck_node_id,
        nodes=[
            NodeResult(
                node_id=analysis.node_id,
                arrival_rate_rps=analysis.arrival_rate_rps,
                service_rate_rps=analysis.service_rate_rps,
                utilization=analysis.utilization,
                latency_ms=_to_milliseconds(analysis.latency_seconds),
                backlog=analysis.backlog,
                status=analysis.status,
            )
            for analysis in result.nodes
        ],
    )


def _to_response(timeline: TimelineResult, kind: TrafficKind) -> SimulationResponse:
    """Assemble the response: the worst sample at the top level, every sample below.

    Seconds are converted here, at the boundary, the same way latency becomes
    milliseconds: the engine reports how many samples were saturated or
    recovering, and every profile samples at TIMELINE_STEP_SECONDS.
    """
    steps = [
        TimelineStep(
            t_seconds=step.t_seconds,
            offered_rps=step.offered_rps,
            **dict(_to_step_result(step.result)),
        )
        for step in timeline.steps
    ]
    return SimulationResponse(
        **dict(_to_step_result(timeline.worst)),
        traffic=TrafficSummary(
            kind=kind,
            duration_seconds=timeline.steps[-1].t_seconds,
            peak_rps=max(step.offered_rps for step in timeline.steps),
            worst_step_index=timeline.worst_index,
            saturated_seconds=timeline.saturated_steps * TIMELINE_STEP_SECONDS,
            recovery_seconds=timeline.recovery_steps * TIMELINE_STEP_SECONDS,
        ),
        timeline=steps,
    )


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe, for the deploy platform and for a quick manual check."""
    return {"status": "ok"}


@app.post("/simulate")
def simulate_design(request: SimulationRequest) -> SimulationResponse:
    """Run a design against a traffic pattern and report where it hurts.

    Pydantic has already rejected malformed *values* by the time this runs; a
    SimulationError here means the design is structurally wrong -- a cycle, no
    entry point, several entry points -- so it maps to 422 alongside the
    validation errors rather than to a 500. The traffic profile is built
    inside the same try for the same reason: its own checks duplicate the
    schema's, and if the two ever disagree the caller should still see a 422.
    """
    specs = [
        ComponentSpec(
            node_id=node.id,
            component_type=node.type,
            replicas=node.config.replicas,
            service_rate_rps=node.config.service_rate_rps,
            hit_ratio=node.config.hit_ratio,
        )
        for node in request.nodes
    ]
    edges = [(edge.source, edge.target) for edge in request.edges]

    try:
        profile = _to_profile(request.traffic)
        timeline = simulate_timeline(specs, edges, profile.steps())
    except (SimulationError, ValueError) as exc:
        # ValueError is caught alongside SimulationError because the engine's own
        # guards (ComponentSpec, queueing._validate_rates) raise it. Any gap
        # between Pydantic's constraints and theirs is still the caller's bad
        # input, and should read as 422 rather than as a server fault.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    return _to_response(timeline, TrafficKind(request.traffic.kind))
