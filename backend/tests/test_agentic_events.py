"""Tests for agentic event shaping and score computation."""

from app.schemas.agentic import AgenticRunState
from app.services.agentic_events import (
    build_agentic_event,
    compute_agentic_score,
    normalize_sse_event,
)


def test_build_agentic_event_contract():
    event = build_agentic_event(
        run_id="run-123",
        state=AgenticRunState.EXECUTING,
        actor="orchestrator",
        payload={"step": "tool_call"},
    )

    dumped = event.model_dump()
    assert dumped["run_id"] == "run-123"
    assert dumped["state"] == AgenticRunState.EXECUTING
    assert dumped["actor"] == "orchestrator"
    assert dumped["payload"]["step"] == "tool_call"
    assert isinstance(dumped["event_id"], str) and dumped["event_id"]
    assert isinstance(dumped["timestamp"], str) and dumped["timestamp"]


def test_compute_agentic_score_baseline():
    events = [
        {
            "type": "agentic_event",
            "payload": {
                "state": AgenticRunState.PLANNING.value,
            },
        },
        {
            "type": "agentic_event",
            "payload": {
                "state": AgenticRunState.EXECUTING.value,
            },
        },
        {
            "type": "agentic_event",
            "payload": {
                "state": AgenticRunState.VERIFYING.value,
            },
        },
        {
            "type": "agentic_event",
            "payload": {
                "state": AgenticRunState.COMPLETED.value,
            },
        },
        {
            "type": "command_approved",
            "payload": {"command_id": "abc"},
        },
    ]

    score = compute_agentic_score(events)

    assert score.score == 100
    assert score.missing == []
    assert score.checks["planning_emitted"] is True
    assert score.checks["execution_emitted"] is True
    assert score.checks["verification_emitted"] is True
    assert score.checks["completion_emitted"] is True
    assert score.checks["approval_outcome_recorded"] is True


def test_normalize_sse_event_backfills_legacy_event_contract():
    legacy = {
        "type": "info",
        "payload": {"message": "legacy replay row"},
        "ts": "2026-01-01T00:00:00Z",
    }

    normalized = normalize_sse_event(legacy, source="workbench")

    assert normalized["type"] == "info"
    assert normalized["payload"]["message"] == "legacy replay row"
    assert normalized["canonical_version"] == "v1"
    assert normalized["canonical_type"] == "system.info"
    assert normalized["canonical_severity"] == "info"
    assert normalized["canonical_source"] == "workbench"


def test_normalize_sse_event_preserves_existing_canonical_fields():
    event = {
        "type": "warning",
        "payload": {"message": "keep existing canonical fields"},
        "canonical_type": "custom.warning",
        "canonical_state": "custom_state",
        "canonical_severity": "warning",
        "canonical_source": "custom",
        "canonical_version": "v2",
        "extra": {"k": "v"},
    }

    normalized = normalize_sse_event(event, source="pipeline")

    assert normalized["canonical_type"] == "custom.warning"
    assert normalized["canonical_state"] == "custom_state"
    assert normalized["canonical_source"] == "custom"
    assert normalized["canonical_version"] == "v2"
    assert normalized["extra"]["k"] == "v"


def test_normalize_sse_event_handles_empty_input_with_defaults():
    normalized = normalize_sse_event(None, source="pipeline")

    assert normalized["type"] == "info"
    assert normalized["payload"] == {}
    assert isinstance(normalized["ts"], str) and normalized["ts"]
    assert normalized["canonical_type"] == "system.info"
    assert normalized["canonical_source"] == "pipeline"
