"""Tests for method feedback capture and aggregation endpoints."""

import pytest

from app.routes import feedback as feedback_route


@pytest.mark.asyncio
async def test_method_feedback_create_and_summary(client, tmp_path, monkeypatch):
    """Method feedback should persist and aggregate per method."""
    monkeypatch.setattr(feedback_route, "METHOD_FEEDBACK_FILE", tmp_path / "method_feedback.json")

    create_res = await client.post(
        "/v1/feedback/methods",
        json={
            "method_id": "bmad",
            "workflow_type": "pipeline",
            "rating": "excellent",
            "review_text": "Great flow",
            "pipeline_id": "pipe-1",
        },
    )
    assert create_res.status_code == 200
    payload = create_res.json()
    assert payload["status"] == "saved"
    assert payload["id"]

    summary_res = await client.get("/v1/feedback/methods/summary?method_id=bmad")
    assert summary_res.status_code == 200
    summary = summary_res.json()
    assert summary["method_id"] == "bmad"
    assert summary["total"] == 1
    assert summary["excellent"] == 1
    assert summary["average_rating"] == "excellent"


@pytest.mark.asyncio
async def test_method_feedback_rejects_invalid_rating(client, tmp_path, monkeypatch):
    """Endpoint should validate feedback rating values."""
    monkeypatch.setattr(feedback_route, "METHOD_FEEDBACK_FILE", tmp_path / "method_feedback.json")

    res = await client.post(
        "/v1/feedback/methods",
        json={
            "method_id": "gsd",
            "workflow_type": "session",
            "rating": "bad",
        },
    )
    assert res.status_code == 422
