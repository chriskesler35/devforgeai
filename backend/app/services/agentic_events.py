"""Agentic event builders and score utilities."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

from app.schemas.agentic import AgenticEvent, AgenticRunState, AgenticScore


_CANONICAL_TYPE_MAP: Dict[str, str] = {
    "init": "lifecycle.init",
    "ping": "lifecycle.ping",
    "info": "system.info",
    "warning": "system.warning",
    "error": "run.error",
    "done": "run.done",
    "user_message": "user.message",
    "role_change": "agent.role_change",
    "agent_thought": "agent.thought",
    "agent_reply": "agent.reply",
    "agentic_event": "agent.state",
    "file_created": "artifact.file_created",
    "file_modified": "artifact.file_modified",
    "files_written": "artifact.files_written",
    "tool_call": "tool.call",
    "waiting": "run.waiting",
    "model_changed": "run.model_changed",
    "command_awaiting_approval": "command.awaiting_approval",
    "command_approved": "command.approved",
    "command_rejected": "command.rejected",
    "command_running": "command.running",
    "command_completed": "command.completed",
    "command_blocked": "command.blocked",
    "command_notice": "command.notice",
    "phase_started": "phase.started",
    "phase_progress": "phase.progress",
    "phase_thinking": "phase.thinking",
    "phase_completed": "phase.completed",
    "phase_failed": "phase.failed",
    "phase_retry": "phase.retry",
    "phase_retry_exhausted": "phase.retry_exhausted",
    "phase_skipped": "phase.skipped",
    "phase_branch": "phase.branch",
    "phase_model_changed": "phase.model_changed",
    "phase_approved": "phase.approved",
    "phase_rejected": "phase.rejected",
    "awaiting_approval": "run.awaiting_approval",
    "pipeline_created": "pipeline.created",
    "pipeline_retry": "pipeline.retry",
    "pipeline_done": "pipeline.done",
}


def _canonical_state_for_event(event_type: str, payload: Dict[str, Any]) -> Optional[str]:
    if event_type == "agentic_event":
        state = payload.get("state")
        return str(state) if state else None

    if event_type in {"error", "phase_failed", "phase_retry_exhausted"}:
        return AgenticRunState.FAILED.value

    if event_type in {"waiting", "awaiting_approval", "command_awaiting_approval"}:
        return AgenticRunState.AWAITING_APPROVAL.value

    if event_type in {
        "agent_thought",
        "agent_reply",
        "role_change",
        "phase_started",
        "phase_progress",
        "phase_thinking",
        "command_running",
        "command_completed",
        "tool_call",
    }:
        return AgenticRunState.EXECUTING.value

    if event_type in {"done", "pipeline_done"}:
        status = str(payload.get("status") or "").strip().lower()
        if status in {
            AgenticRunState.COMPLETED.value,
            AgenticRunState.FAILED.value,
            AgenticRunState.CANCELLED.value,
            AgenticRunState.AWAITING_APPROVAL.value,
        }:
            return status
        return AgenticRunState.COMPLETED.value

    return None


def canonical_event_fields(event_type: str, payload: Optional[Dict[str, Any]] = None, *, source: str = "runtime") -> Dict[str, Any]:
    """Return canonical event metadata while preserving legacy event types."""

    data = payload or {}
    severity = "info"
    if event_type in {"error", "phase_failed", "phase_retry_exhausted"}:
        severity = "error"
    elif event_type in {
        "warning",
        "awaiting_approval",
        "waiting",
        "phase_retry",
        "phase_rejected",
        "command_awaiting_approval",
        "command_rejected",
    }:
        severity = "warning"

    return {
        "canonical_version": "v1",
        "canonical_type": _CANONICAL_TYPE_MAP.get(event_type, f"legacy.{event_type}"),
        "canonical_state": _canonical_state_for_event(event_type, data),
        "canonical_severity": severity,
        "canonical_source": source,
    }


def build_agentic_event(
    run_id: str,
    state: AgenticRunState,
    actor: str,
    payload: Optional[Dict[str, Any]] = None,
) -> AgenticEvent:
    """Create a normalized agentic event."""

    return AgenticEvent(
        event_id=str(uuid.uuid4()),
        run_id=run_id,
        state=state,
        actor=actor,
        payload=payload or {},
        timestamp=datetime.utcnow().isoformat(),
    )


def compute_agentic_score(events: Iterable[dict]) -> AgenticScore:
    """Compute a basic phase-0 agentic score from emitted events."""

    event_list = list(events)
    has_planning = any(
        e.get("type") == "agentic_event" and e.get("payload", {}).get("state") == AgenticRunState.PLANNING.value
        for e in event_list
    )
    has_execution = any(
        e.get("type") == "agentic_event" and e.get("payload", {}).get("state") == AgenticRunState.EXECUTING.value
        for e in event_list
    )
    has_verification = any(
        e.get("type") == "agentic_event" and e.get("payload", {}).get("state") == AgenticRunState.VERIFYING.value
        for e in event_list
    )
    has_completion = any(
        e.get("type") == "agentic_event" and e.get("payload", {}).get("state") == AgenticRunState.COMPLETED.value
        for e in event_list
    )
    has_approval_outcome = any(
        e.get("type") in {"command_approved", "command_rejected"}
        for e in event_list
    )

    checks = {
        "planning_emitted": has_planning,
        "execution_emitted": has_execution,
        "verification_emitted": has_verification,
        "completion_emitted": has_completion,
        "approval_outcome_recorded": has_approval_outcome,
    }

    score = 0
    score += 25 if has_planning else 0
    score += 25 if has_execution else 0
    score += 25 if has_verification else 0
    score += 25 if has_completion else 0

    missing = [name for name, ok in checks.items() if not ok]

    return AgenticScore(
        score=score,
        checks=checks,
        missing=missing,
        event_count=len(event_list),
    )
