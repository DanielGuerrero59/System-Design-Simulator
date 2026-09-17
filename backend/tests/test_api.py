"""API-level tests: the HTTP contract the React frontend will code against."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import RampTraffic, SpikeTraffic, SteadyTraffic
from app.simulation.constants import (
    DEFAULT_TRAFFIC_DURATION_SECONDS,
    MAX_NODES,
    MAX_TRAFFIC_DURATION_SECONDS,
    TrafficKind,
)

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
            "traffic",
            "timeline",
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
        # The tag sits in the path since traffic became a tagged union: the
        # error names which shape it was validated as, which is the one thing
        # a legacy client can observe about the change -- and only on errors.
        assert detail[0]["loc"] == ["body", "traffic", "steady", "requests_per_second"]

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

        original = main_module.simulate_timeline
        main_module.simulate_timeline = _raise_value_error
        try:
            response = TestClient(
                main_module.app, raise_server_exceptions=False
            ).post("/simulate", json=design(1_000.0))
        finally:
            main_module.simulate_timeline = original
        assert response.status_code == 422

    def test_unknown_component_type_is_rejected(self) -> None:
        payload = design(1_000.0)
        payload["nodes"][1]["type"] = "quantum_blockchain"
        assert client.post("/simulate", json=payload).status_code == 422


# Baseline 1,500 with a two-second burst to 2,500 at t = 2 and 3, in a
# six-second window: 1,500, 1,500, 2,500, 2,500, 1,500, 1,500, 1,500.
SPIKE = {
    "kind": "spike",
    "baseline_rps": 1_500.0,
    "peak_rps": 2_500.0,
    "duration_seconds": 6,
    "peak_start_seconds": 2,
    "peak_seconds": 2,
}
# 1,000 -> 3,000 over four seconds: 1,000, 1,500, 2,000, 2,500, 3,000.
RAMP = {"kind": "ramp", "start_rps": 1_000.0, "end_rps": 3_000.0, "duration_seconds": 4}

STEP_KEYS = {"is_stable", "total_latency_ms", "bottleneck_node_id", "nodes"}


def top_level(body: dict[str, Any]) -> dict[str, Any]:
    return {key: body[key] for key in STEP_KEYS}


class TestTrafficPresets:
    def test_legacy_body_is_a_steady_rate_with_one_sample(self) -> None:
        body = client.post("/simulate", json=design(1_500.0)).json()

        assert body["traffic"] == {
            "kind": "steady",
            "duration_seconds": 0,
            "peak_rps": 1_500.0,
            "worst_step_index": 0,
            "saturated_seconds": 0,
        }
        assert len(body["timeline"]) == 1
        step = body["timeline"][0]
        assert step["t_seconds"] == 0
        assert step["offered_rps"] == 1_500.0
        assert top_level(step) == top_level(body)

    def test_explicit_steady_kind_is_identical_to_the_legacy_body(self) -> None:
        legacy = client.post("/simulate", json=design(1_500.0)).json()
        explicit = client.post(
            "/simulate",
            json=design(0.0, traffic={"kind": "steady", "requests_per_second": 1_500.0}),
        ).json()
        assert explicit == legacy

    def test_spike_reports_every_sample_and_the_worst_one(self) -> None:
        body = client.post("/simulate", json=design(0.0, traffic=SPIKE)).json()

        assert [s["offered_rps"] for s in body["timeline"]] == [
            1_500, 1_500, 2_500, 2_500, 1_500, 1_500, 1_500
        ]
        assert [s["t_seconds"] for s in body["timeline"]] == [0, 1, 2, 3, 4, 5, 6]
        assert body["traffic"] == {
            "kind": "spike",
            "duration_seconds": 6,
            "peak_rps": 2_500.0,
            "worst_step_index": 2,
            "saturated_seconds": 2,
        }
        # The top level is the first second of the burst, where the app tier
        # saturates (rho = 2,500 / 2,000 = 1.25).
        assert top_level(body) == top_level(body["timeline"][2])
        assert body["is_stable"] is False
        assert body["total_latency_ms"] is None
        assert node(body, "api")["utilization"] == pytest.approx(1.25)
        # Before the burst: 1 / (2,000 - 1,500) s = 2 ms at the app tier.
        first = body["timeline"][0]
        assert first["is_stable"] is True
        assert node(first, "api")["latency_ms"] == pytest.approx(2.0)

    def test_ramp_sweeps_the_rate_and_counts_saturated_seconds(self) -> None:
        body = client.post("/simulate", json=design(0.0, traffic=RAMP)).json()

        assert [s["offered_rps"] for s in body["timeline"]] == [1_000, 1_500, 2_000, 2_500, 3_000]
        # rho hits exactly 1.0 at 2,000 rps and that already counts as saturated.
        assert [s["is_stable"] for s in body["timeline"]] == [True, True, False, False, False]
        assert body["traffic"]["worst_step_index"] == 4
        assert body["traffic"]["saturated_seconds"] == 3
        assert body["traffic"]["peak_rps"] == 3_000.0

    def test_window_defaults_apply(self) -> None:
        body = client.post(
            "/simulate",
            json=design(0.0, traffic={"kind": "spike", "baseline_rps": 1_000.0, "peak_rps": 1_500.0}),
        ).json()
        assert len(body["timeline"]) == DEFAULT_TRAFFIC_DURATION_SECONDS + 1
        assert body["traffic"]["duration_seconds"] == DEFAULT_TRAFFIC_DURATION_SECONDS

    def test_every_sample_has_the_full_step_shape(self) -> None:
        body = client.post("/simulate", json=design(0.0, traffic=RAMP)).json()
        for step in body["timeline"]:
            assert set(step) == STEP_KEYS | {"t_seconds", "offered_rps"}
            assert set(step["nodes"][0]) == set(body["nodes"][0])

    def test_peak_not_above_baseline_is_rejected(self) -> None:
        response = client.post(
            "/simulate", json=design(0.0, traffic={**SPIKE, "peak_rps": 1_500.0})
        )
        assert response.status_code == 422
        assert "peak_rps must exceed baseline_rps" in response.json()["detail"][0]["msg"]

    def test_burst_overflowing_the_window_is_rejected(self) -> None:
        response = client.post(
            "/simulate", json=design(0.0, traffic={**SPIKE, "peak_start_seconds": 5})
        )
        assert response.status_code == 422
        assert "after the 6s window" in response.json()["detail"][0]["msg"]

    def test_missing_field_names_the_shape_in_its_path(self) -> None:
        spike = {key: value for key, value in SPIKE.items() if key != "peak_rps"}
        response = client.post("/simulate", json=design(0.0, traffic=spike))
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "traffic", "spike", "peak_rps"]

    def test_unknown_kind_lists_the_accepted_ones(self) -> None:
        response = client.post("/simulate", json=design(0.0, traffic={"kind": "tsunami"}))
        assert response.status_code == 422
        message = response.json()["detail"][0]["msg"]
        for kind in TrafficKind:
            assert repr(kind.value) in message

    def test_window_over_the_ceiling_is_rejected(self) -> None:
        response = client.post(
            "/simulate",
            json=design(0.0, traffic={**RAMP, "duration_seconds": MAX_TRAFFIC_DURATION_SECONDS + 1}),
        )
        assert response.status_code == 422

    def test_non_finite_literal_inside_a_spike_is_a_clean_422(self) -> None:
        """The custom error handler covers the new shapes too."""
        body = (
            '{"nodes":[{"id":"api","type":"app_server"}],"edges":[],'
            '"traffic":{"kind":"spike","baseline_rps":1000,"peak_rps":Infinity}}'
        )
        response = client.post(
            "/simulate", content=body, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        assert "detail" in response.json()

    def test_openapi_schema_renders_the_union(self) -> None:
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert {"SteadyTraffic", "SpikeTraffic", "RampTraffic"} <= set(
            response.json()["components"]["schemas"]
        )

    def test_schema_tags_match_traffic_kind(self) -> None:
        """Same guarantee the component registry gives: no kind without a schema."""
        from typing import get_args

        tags = {
            get_args(model.model_fields["kind"].annotation)[0]
            for model in (SteadyTraffic, SpikeTraffic, RampTraffic)
        }
        assert tags == {kind.value for kind in TrafficKind}
