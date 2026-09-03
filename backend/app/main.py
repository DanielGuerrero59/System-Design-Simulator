"""FastAPI application: the only module in the project that knows about HTTP.

Its whole job is translation. Pydantic models come in, get converted into the
framework-free types the engine understands, and the engine's result is
converted back. No simulation logic lives here, which is what keeps the engine
testable without a server.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from .schemas import NodeResult, SimulationRequest, SimulationResponse
from .simulation.components import ComponentSpec
from .simulation.constants import MILLISECONDS_PER_SECOND
from .simulation.engine import SimulationError, SimulationResult, simulate

# The React dev server, on both common ports (Vite and Create React App). The
# deployed frontend origin will need adding here before it can call the API.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

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


def _to_milliseconds(seconds: float | None) -> float | None:
    """Convert to the API's unit, preserving None.

    None means saturated, and it has to survive the conversion intact -- a
    saturated component must never come out the other side as 0.0.
    """
    if seconds is None:
        return None
    return seconds * MILLISECONDS_PER_SECOND


def _to_response(result: SimulationResult) -> SimulationResponse:
    """Map the engine's framework-free result onto the wire format."""
    return SimulationResponse(
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
                status=analysis.status,
            )
            for analysis in result.nodes
        ],
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
    validation errors rather than to a 500.
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
        result = simulate(specs, edges, request.traffic.requests_per_second)
    except SimulationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    return _to_response(result)
