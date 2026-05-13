"""Run service — CRUD, state machine, fork, method attachment."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence

from fastapi import HTTPException
from sqlalchemy import select, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.custom_method import CustomMethod
from app.models.run import (
    Run, RunPhase, RunMessage, RunEvent,
    RUN_STATES, RUN_TRANSITIONS, PHASE_STATUSES, EVENT_KINDS,
)

logger = logging.getLogger(__name__)

TERMINAL_STATES = frozenset({"completed", "failed", "cancelled", "archived"})
ACTIVE_STATES = RUN_STATES - TERMINAL_STATES


class InvalidRunStateTransition(HTTPException):
    def __init__(self, current: str, target: str):
        super().__init__(
            status_code=409,
            detail=f"Cannot transition Run from '{current}' to '{target}'",
        )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_run(
    db: AsyncSession,
    *,
    project_id: str = "scratch",
    method_id: str | None = None,
    title: str | None = None,
) -> Run:
    project = await db.get(Project, project_id)
    if not project or not project.is_active:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found or inactive")

    run = Run(
        id=str(uuid.uuid4()),
        title=title,
        project_id=project_id,
        method_id=method_id,
        state="awaiting_input",
        power_tools_enabled=False,
    )
    db.add(run)
    await db.flush()
    return run


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

async def transition(db: AsyncSession, run: Run, new_state: str) -> Run:
    if new_state not in RUN_STATES:
        raise HTTPException(status_code=400, detail=f"Unknown state: {new_state}")

    allowed = RUN_TRANSITIONS.get(run.state, set())
    if new_state not in allowed:
        raise InvalidRunStateTransition(run.state, new_state)

    run.state = new_state
    run.updated_at = datetime.now(timezone.utc)

    if new_state == "completed":
        run.completed_at = datetime.now(timezone.utc)

    await db.flush()
    return run


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def update_run(
    db: AsyncSession,
    run: Run,
    *,
    title: str | None = None,
    power_tools_enabled: bool | None = None,
) -> Run:
    if title is not None:
        run.title = title
    if power_tools_enabled is not None:
        run.power_tools_enabled = power_tools_enabled
    run.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return run


# ---------------------------------------------------------------------------
# Fork
# ---------------------------------------------------------------------------

async def fork_run(
    db: AsyncSession,
    source_run: Run,
    event_id: str,
) -> Run:
    if not source_run.power_tools_enabled:
        raise HTTPException(
            status_code=403,
            detail="Power tools disabled for this Run",
        )

    event = await db.get(RunEvent, event_id)
    if not event or event.run_id != source_run.id:
        raise HTTPException(status_code=404, detail="Event not found in this Run")

    forked = Run(
        id=str(uuid.uuid4()),
        title=f"Fork of {source_run.title or source_run.id[:8]}",
        project_id=source_run.project_id,
        method_id=source_run.method_id,
        state="awaiting_input",
        forked_from_event_id=event_id,
        power_tools_enabled=source_run.power_tools_enabled,
    )
    db.add(forked)
    await db.flush()
    return forked


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

async def list_runs(
    db: AsyncSession,
    *,
    project_id: str | None = None,
    states: Sequence[str] | None = None,
    active: bool = False,
    limit: int = 50,
    cursor: str | None = None,
) -> list[Run]:
    q = select(Run)

    if project_id:
        q = q.where(Run.project_id == project_id)

    if active:
        q = q.where(Run.state.in_(ACTIVE_STATES))
    elif states:
        q = q.where(Run.state.in_(states))

    if cursor:
        q = q.where(Run.updated_at < cursor)

    q = q.order_by(desc(Run.updated_at)).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_run(db: AsyncSession, run_id: str) -> Run:
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


async def get_run_detail(
    db: AsyncSession,
    run_id: str,
    *,
    message_limit: int = 50,
    event_limit: int = 100,
) -> dict:
    run = await get_run(db, run_id)

    phases_q = select(RunPhase).where(RunPhase.run_id == run_id).order_by(RunPhase.index)
    phases = (await db.execute(phases_q)).scalars().all()

    messages_q = (
        select(RunMessage)
        .where(RunMessage.run_id == run_id)
        .order_by(desc(RunMessage.created_at))
        .limit(message_limit)
    )
    messages = list(reversed((await db.execute(messages_q)).scalars().all()))

    events_q = (
        select(RunEvent)
        .where(RunEvent.run_id == run_id)
        .order_by(desc(RunEvent.created_at))
        .limit(event_limit)
    )
    events = list(reversed((await db.execute(events_q)).scalars().all()))

    return {
        "run": run,
        "phases": phases,
        "messages": messages,
        "events": events,
    }


async def get_run_messages(
    db: AsyncSession,
    run_id: str,
    *,
    limit: int = 50,
    cursor: str | None = None,
) -> list[RunMessage]:
    q = select(RunMessage).where(RunMessage.run_id == run_id)
    if cursor:
        q = q.where(RunMessage.created_at < cursor)
    q = q.order_by(desc(RunMessage.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return list(reversed(rows))


async def get_run_events(
    db: AsyncSession,
    run_id: str,
    *,
    phase_id: str | None = None,
    since: str | None = None,
    limit: int = 100,
) -> list[RunEvent]:
    q = select(RunEvent).where(RunEvent.run_id == run_id)
    if phase_id:
        q = q.where(RunEvent.phase_id == phase_id)
    if since:
        q = q.where(RunEvent.created_at > since)
    q = q.order_by(desc(RunEvent.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return list(reversed(rows))


async def get_event_full(db: AsyncSession, run_id: str, event_id: str) -> RunEvent:
    event = await db.get(RunEvent, event_id)
    if not event or event.run_id != run_id:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


# ---------------------------------------------------------------------------
# Method validation + attachment
# ---------------------------------------------------------------------------

async def resolve_method_id(db: AsyncSession, method_id: str) -> str:
    """Validate method_id against built-in methods and CustomMethod table.
    Returns the canonical method_id or raises 400."""
    from app.routes.methods import BUILT_IN_METHODS
    if method_id in BUILT_IN_METHODS:
        return method_id

    custom = await db.execute(
        select(CustomMethod).where(
            CustomMethod.is_active == True,
            (CustomMethod.id == method_id) | (CustomMethod.name == method_id),
        )
    )
    row = custom.scalars().first()
    if row:
        return row.id

    raise HTTPException(status_code=400, detail=f"Unknown method: {method_id}")


async def attach_method(db: AsyncSession, run: Run, method_id: str) -> Run:
    """Attach a validated method to a Run. Creates phases from the method definition."""
    canonical_id = await resolve_method_id(db, method_id)
    run.method_id = canonical_id
    run.updated_at = datetime.now(timezone.utc)

    phases = _get_method_phases(canonical_id)
    for i, phase_def in enumerate(phases):
        phase = RunPhase(
            id=str(uuid.uuid4()),
            run_id=run.id,
            index=i,
            name=phase_def.get("name", f"Phase {i}"),
            agent_role=phase_def.get("role"),
            model_id=phase_def.get("default_model"),
            status="queued",
        )
        db.add(phase)

    await db.flush()
    return run


def _get_method_phases(method_id: str) -> list[dict]:
    """Return phase definitions for a method_id."""
    from app.routes.methods import BUILT_IN_METHODS
    builtin = BUILT_IN_METHODS.get(method_id)
    if builtin:
        raw = builtin.get("phases", [])
        if raw and isinstance(raw[0], str):
            return [{"name": name} for name in raw]
        return raw
    return []


# ---------------------------------------------------------------------------
# Slash command handling
# ---------------------------------------------------------------------------

async def handle_slash_command(
    db: AsyncSession,
    run: Run,
    content: str,
) -> dict | None:
    """Parse slash commands from user message content.

    Returns a response dict if handled, or None if the message is not a command.

    Supported commands:
      /method <name>  — attach a method to this Run
      /fork <event_id> — handled by POST /v1/runs/:id/fork (frontend sends it directly)
    """
    stripped = content.strip()
    if not stripped.startswith("/"):
        return None

    parts = stripped.split(None, 1)
    cmd = parts[0].lower()

    if cmd == "/method" and len(parts) > 1:
        method_id = parts[1].strip()
        run = await attach_method(db, run, method_id)

        from app.services.run_events import emit
        await emit(
            db, run.id, "user_intervention",
            summary=f"Attached method: {method_id}",
        )
        return {"handled": True, "action": "method_attached", "method_id": run.method_id}

    return None
