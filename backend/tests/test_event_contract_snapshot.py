"""Snapshot-style contract tests for canonical event metadata mapping."""

import pytest

from app.services.agentic_events import canonical_event_fields, normalize_sse_event


@pytest.mark.parametrize(
    "event_type,payload,expected",
    [
        (
            "info",
            {"message": "hello"},
            {
                "canonical_type": "system.info",
                "canonical_state": None,
                "canonical_severity": "info",
            },
        ),
        (
            "error",
            {"message": "boom"},
            {
                "canonical_type": "run.error",
                "canonical_state": "failed",
                "canonical_severity": "error",
            },
        ),
        (
            "waiting",
            {"message": "need approval"},
            {
                "canonical_type": "run.waiting",
                "canonical_state": "awaiting_approval",
                "canonical_severity": "warning",
            },
        ),
        (
            "done",
            {"status": "cancelled"},
            {
                "canonical_type": "run.done",
                "canonical_state": "cancelled",
                "canonical_severity": "info",
            },
        ),
        (
            "phase_started",
            {"phase_index": 0, "phase_name": "Coder"},
            {
                "canonical_type": "phase.started",
                "canonical_state": "executing",
                "canonical_severity": "info",
            },
        ),
        (
            "phase_failed",
            {"phase_index": 0, "error": "timeout"},
            {
                "canonical_type": "phase.failed",
                "canonical_state": "failed",
                "canonical_severity": "error",
            },
        ),
        (
            "pipeline_done",
            {"status": "completed"},
            {
                "canonical_type": "pipeline.done",
                "canonical_state": "completed",
                "canonical_severity": "info",
            },
        ),
        (
            "command_awaiting_approval",
            {"command": "rm -rf /tmp"},
            {
                "canonical_type": "command.awaiting_approval",
                "canonical_state": "awaiting_approval",
                "canonical_severity": "warning",
            },
        ),
    ],
)
def test_canonical_event_fields_snapshot(event_type, payload, expected):
    result = canonical_event_fields(event_type, payload, source="snapshot")

    assert result["canonical_version"] == "v1"
    assert result["canonical_source"] == "snapshot"
    assert result["canonical_type"] == expected["canonical_type"]
    assert result["canonical_state"] == expected["canonical_state"]
    assert result["canonical_severity"] == expected["canonical_severity"]


@pytest.mark.parametrize(
    "legacy_event,expected_type,expected_state",
    [
        (
            {
                "type": "phase_failed",
                "payload": {"phase_name": "QA", "error": "rate limit"},
                "ts": "2026-01-01T00:00:00Z",
            },
            "phase.failed",
            "failed",
        ),
        (
            {
                "type": "done",
                "payload": {"status": "awaiting_approval", "message": "waiting"},
                "ts": "2026-01-01T00:00:01Z",
            },
            "run.done",
            "awaiting_approval",
        ),
    ],
)
def test_normalize_sse_event_snapshot_for_legacy_rows(legacy_event, expected_type, expected_state):
    normalized = normalize_sse_event(legacy_event, source="snapshot")

    assert normalized["type"] == legacy_event["type"]
    assert normalized["payload"] == legacy_event["payload"]
    assert normalized["ts"] == legacy_event["ts"]
    assert normalized["canonical_version"] == "v1"
    assert normalized["canonical_source"] == "snapshot"
    assert normalized["canonical_type"] == expected_type
    assert normalized["canonical_state"] == expected_state
