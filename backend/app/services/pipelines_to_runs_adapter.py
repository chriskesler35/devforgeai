"""Legacy pipeline → Run event adapter.

Maps pipeline event types emitted by pipelines._push to RunEvent.kind values
per the spec (phase_start, phase_end, agent_start, tool_call, tool_result,
model_request, model_response, approval_gate, user_intervention, error).

Pipeline event type → RunEvent kind mapping:
  pipeline_created       → phase_start  (pipeline kickoff)
  phase_thinking         → model_request
  phase_progress         → model_response
  phase_branch           → phase_start
  phase_skipped          → phase_end
  phase_approved         → user_intervention
  phase_rejected         → user_intervention
  phase_approval_update  → approval_gate
  awaiting_approval      → approval_gate
  command_awaiting_approval → approval_gate
  command_running        → tool_call
  command_completed      → tool_result
  files_written          → tool_result
  pipeline_done          → phase_end
  pipeline_paused        → user_intervention
  pipeline_resumed       → user_intervention
  pipeline_cancelled     → (omitted — state change, not an event)
  info                   → model_response  (informational)
  warning                → error
  error                  → error
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

_KIND_MAP: dict[str, str] = {
    "pipeline_created":         "phase_start",
    "phase_thinking":           "model_request",
    "phase_progress":           "model_response",
    "phase_branch":             "phase_start",
    "phase_skipped":            "phase_end",
    "phase_approved":           "user_intervention",
    "phase_rejected":           "user_intervention",
    "phase_approval_update":    "approval_gate",
    "awaiting_approval":        "approval_gate",
    "command_awaiting_approval":"approval_gate",
    "command_running":          "tool_call",
    "command_completed":        "tool_result",
    "files_written":            "tool_result",
    "pipeline_done":            "phase_end",
    "pipeline_paused":          "user_intervention",
    "pipeline_resumed":         "user_intervention",
    "info":                     "model_response",
    "warning":                  "error",
    "error":                    "error",
}

# Types that are pure noise / state-change signals — not worth persisting as RunEvents.
_SKIP_TYPES = frozenset({"ping", "pipeline_cancelled"})


def map_event(pipeline_type: str, payload: dict[str, Any]) -> tuple[str, str] | None:
    """Return (kind, summary) for a pipeline event, or None to skip."""
    if pipeline_type in _SKIP_TYPES:
        return None

    kind = _KIND_MAP.get(pipeline_type)
    if not kind:
        logger.debug("Unmapped pipeline event type '%s' — skipping", pipeline_type)
        return None

    summary = (
        payload.get("message")
        or payload.get("reason")
        or payload.get("phase_name")
        or pipeline_type.replace("_", " ")
    )
    if isinstance(summary, str):
        summary = summary[:200]
    else:
        summary = str(summary)[:200]

    return kind, summary


async def mirror_pipeline_event(
    run_id: str | None,
    pipeline_type: str,
    payload: dict[str, Any],
    *,
    phase_id: str | None = None,
) -> None:
    """Fire-and-forget: persist a RunEvent mirroring a legacy pipeline event.

    Called from pipelines._push when runs_unified_enabled is True.
    """
    if not run_id:
        return

    mapped = map_event(pipeline_type, payload)
    if not mapped:
        return

    kind, summary = mapped

    try:
        from app.database import AsyncSessionLocal
        from app.services.run_events import emit

        async with AsyncSessionLocal() as db:
            await emit(
                db, run_id, kind, summary,
                payload={"legacy_type": pipeline_type, **payload},
                phase_id=phase_id,
            )
            await db.commit()
    except Exception:
        logger.warning("Failed to mirror pipeline event to run %s", run_id, exc_info=True)
