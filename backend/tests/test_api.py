"""API-level tests: the HTTP contract the React frontend will code against."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.simulation.constants import MAX_NODES

client = TestClient(app)


def _raise_value_error(*args: Any, **kwargs: Any) -> None:
    raise ValueError("engine-level validation failure")


def design(traffic_rps: float, **overrides: Any) -> dict[str, Any]:
    """The canonical LB -> API -> DB design, with room to tweak one field."""
    payload: dict[str, Any] = {
        "nodes": [
            {"id": "lb", "type": "load_balancer"},
            {"id": "api", "type": "app_server"},
            {"id": "db", "type": "database"},
        ],
        "edges": [
            {"source": "lb", "target": "api"},
            {"source": "api", "target": "db"},
        ],
        "traffic": {"requests_per_second": traffic_rps},
    }
    payload.update(overrides)
    return payload


def node(body: dict[str, Any], node_id: str) -> dict[str, Any]:
    return next(n for n in body["nodes"] if n["node_id"] == node_id)


class TestHealth:
    def test_health_is_ok(self) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestSimulateHappyPath:
    def test_returns_200_and_full_shape(self) -> None:
        response = client.post("/simulate", json=design(1_500.0))
        assert response.status_code == 200

        body = response.json()
        assert set(body) == {
            "is_stable",
            "total_latency_ms",
            "bottleneck_node_id",
            "nodes",
        }
        assert set(body["nodes"][0]) == {
            "node_id",
            "arrival_rate_rps",
            "service_rate_rps",
            "utilization",
            "latency_ms",
            "status",
        }

    def test_latency_is_reported_in_milliseconds(self) -> None:
        """W = 1/(2000-1500) = 0.002 s, so the wire value must be 2.0, not 0.002."""
        body = client.post("/simulate", json=design(1_500.0)).json()
        assert node(body, "api")["latency_ms"] == pytest.approx(2.0)

    def test_enums_serialise_as_plain_strings(self) -> None:
        """React compares these against string literals, so no nested objects."""
        body = client.post("/simulate", json=design(1_500.0)).json()
        assert node(body, "api")["status"] == "warning"
        assert node(body, "lb")["status"] == "healthy"

    def test_reports_stability_and_bottleneck(self) -> None:
        body = client.post("/simulate", json=design(1_500.0)).json()
        assert body["is_stable"] is True
        assert body["bottleneck_node_id"] == "api"
        assert body["total_latency_ms"] == pytest.approx(
            (1 / (50_000 - 1_500) + 1 / (2_000 - 1_500) + 1 / (5_000 - 1_500)) * 1000
        )


class TestSimulateSaturated:
    def test_saturation_is_null_not_a_number(self) -> None:
        """The whole reason the latency fields are nullable."""
        body = client.post("/simulate", json=design(10_000.0)).json()
        assert body["is_stable"] is False
        assert body["total_latency_ms"] is None
        assert node(body, "api")["latency_ms"] is None
        assert node(body, "api")["status"] == "saturated"

    def test_healthy_nodes_keep_their_numbers(self) -> None:
        body = client.post("/simulate", json=design(10_000.0)).json()
        assert node(body, "lb")["latency_ms"] is not None


class TestCacheChangesTheOutcome:
    def test_adding_a_cache_makes_an_unstable_design_stable(self) -> None:
        payload = {
            "nodes": [
                {"id": "lb", "type": "load_balancer"},
                {"id": "api", "type": "app_server", "config": {"replicas": 8}},
                {"id": "cache", "type": "cache", "config": {"hit_ratio": 0.9}},
                {"id": "db", "type": "database"},
            ],
            "edges": [
                {"source": "lb", "target": "api"},
                {"source": "api", "target": "cache"},
                {"source": "cache", "target": "db"},
            ],
            "traffic": {"requests_per_second": 10_000},
        }
        body = client.post("/simulate", json=payload).json()

        assert body["is_stable"] is True
        assert node(body, "db")["arrival_rate_rps"] == pytest.approx(1_000.0)


class TestRejections:
    def test_structural_problem_is_422_with_a_readable_reason(self) -> None:
        """lb <-> api is a cycle, while db remains a legitimate lone entry point,
        so the engine should name the cycle rather than blame the entry point."""
        payload = design(1_000.0)
        payload["edges"] = [
            {"source": "lb", "target": "api"},
            {"source": "api", "target": "lb"},
        ]
        response = client.post("/simulate", json=payload)
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "cycle" in detail
        assert "'api'" in detail and "'lb'" in detail

    def test_multiple_entry_points_rejected(self) -> None:
        payload = design(1_000.0)
        payload["edges"] = [{"source": "lb", "target": "db"}]
        response = client.post("/simulate", json=payload)
        assert response.status_code == 422
        assert "entry point" in response.json()["detail"]

    @pytest.mark.parametrize(
        "mutation",
        [
            {"traffic": {"requests_per_second": 0}},
            {"traffic": {"requests_per_second": -5}},
            {"nodes": []},
        ],
    )
    def test_invalid_values_rejected_by_the_schema(
        self, mutation: dict[str, Any]
    ) -> None:
        assert client.post("/simulate", json=design(1_000.0, **mutation)).status_code == 422

    def test_hit_ratio_on_a_non_cache_is_rejected(self) -> None:
        payload = design(1_000.0)
        payload["nodes"][2]["config"] = {"hit_ratio": 0.5}
        response = client.post("/simulate", json=payload)
        assert response.status_code == 422

    def test_service_rate_above_the_ceiling_is_rejected(self) -> None:
        """Named for what it actually sends: a large finite value, not infinity."""
        payload = design(1_000.0)
        payload["nodes"][1]["config"] = {"service_rate_rps": 1e12}
        assert client.post("/simulate", json=payload).status_code == 422

    @pytest.mark.parametrize("token", ["Infinity", "-Infinity", "NaN"])
    def test_non_finite_literal_is_a_clean_422(self, token: str) -> None:
        """Rejected without crashing the error handler on the way out.

        These are not valid JSON, but Python's parser accepts the bare tokens, so
        they genuinely arrive over the wire. FastAPI's default handler echoes the
        rejected input back, and json.dumps cannot encode inf or nan -- so before
        the custom handler in main.py this path raised inside the error handler
        and surfaced as an unhandled 500. Sent as raw content because json= would
        refuse to encode it.
        """
        body = (
            '{"nodes":[{"id":"lb","type":"load_balancer"},'
            '{"id":"api","type":"app_server","config":{"service_rate_rps":TOKEN}}],'
            '"edges":[{"source":"lb","target":"api"}],'
            '"traffic":{"requests_per_second":1000}}'
        ).replace("TOKEN", token)
        response = client.post(
            "/simulate", content=body, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        assert "detail" in response.json()

    def test_ordinary_validation_errors_keep_their_shape(self) -> None:
        """The custom handler must not change the contract for normal failures."""
        response = client.post("/simulate", json=design(-1.0))
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail[0]["type"] == "greater_than"
        assert detail[0]["loc"] == ["body", "traffic", "requests_per_second"]

    def test_oversized_design_is_rejected(self) -> None:
        """An unbounded node list is an easy way to make one request expensive."""
        payload = design(1_000.0)
        payload["nodes"] = [
            {"id": f"n{i}", "type": "app_server"} for i in range(MAX_NODES + 1)
        ]
        payload["edges"] = []
        assert client.post("/simulate", json=payload).status_code == 422

    def test_engine_value_error_is_a_422_not_a_500(self) -> None:
        """Engine-layer guards raise ValueError; that is bad input, not a fault."""
        import app.main as main_module

        original = main_module.simulate
        main_module.simulate = _raise_value_error
        try:
            response = TestClient(
                main_module.app, raise_server_exceptions=False
            ).post("/simulate", json=design(1_000.0))
        finally:
            main_module.simulate = original
        assert response.status_code == 422

    def test_unknown_component_type_is_rejected(self) -> None:
        payload = design(1_000.0)
        payload["nodes"][1]["type"] = "quantum_blockchain"
        assert client.post("/simulate", json=payload).status_code == 422
