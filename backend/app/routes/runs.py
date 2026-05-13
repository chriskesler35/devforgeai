"""Run API routes — /v1/runs/* CRUD, lifecycle, and SSE stream."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import verify_api_key
from app.schemas.run import (
    RunCreate, RunUpdate, RunOut, RunDetailOut,
    RunMessageIn, RunMessageOut,
    RunAttachMethod, RunFork, RunApprovalAction,
    RunPhaseOut, RunEventSummary, RunEventFull,
)
from app.services import runs as run_svc
from app.services import run_events

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/runs", tags=["runs"])


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.post("", response_model=RunOut, status_code=201, dependencies=[Depends(verify_api_key)])
async def create_run(body: RunCreate, db: AsyncSession = Depends(get_db)):
    run = await run_svc.create_run(
        db,
        project_id=body.project_id,
        method_id=body.method_id,
        title=body.title,
    )
    await db.commit()
    await db.refresh(run)
    return run


@router.get("", response_model=list[RunOut], dependencies=[Depends(verify_api_key)])
async def list_runs(
    project_id: Optional[str] = None,
    state: Optional[str] = None,
    active: bool = False,
    limit: int = Query(50, le=200),
    cursor: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    states = [state] if state else None
    return await run_svc.list_runs(
        db,
        project_id=project_id,
        states=states,
        active=active,
        limit=limit,
        cursor=cursor,
    )


@router.get("/{run_id}", response_model=RunDetailOut, dependencies=[Depends(verify_api_key)])
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    detail = await run_svc.get_run_detail(db, run_id)
    return RunDetailOut(
        **RunOut.model_validate(detail["run"]).model_dump(),
        phases=[RunPhaseOut.model_validate(p) for p in detail["phases"]],
        messages=[RunMessageOut.model_validate(m) for m in detail["messages"]],
        events=[RunEventSummary.model_validate(e) for e in detail["events"]],
    )


@router.patch("/{run_id}", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def update_run(run_id: str, body: RunUpdate, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    run = await run_svc.update_run(
        db, run,
        title=body.title,
        power_tools_enabled=body.power_tools_enabled,
    )
    await db.commit()
    await db.refresh(run)
    return run


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

@router.post("/{run_id}/messages", status_code=201, dependencies=[Depends(verify_api_key)])
async def post_message(run_id: str, body: RunMessageIn, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)

    slash_result = await run_svc.handle_slash_command(db, run, body.content)
    if slash_result:
        await db.commit()
        return slash_result

    msg = await run_events.record_message(
        db, run_id,
        role=body.role,
        content=body.content,
        image_url=body.image_url,
    )
    await db.commit()
    await db.refresh(msg)
    return msg


@router.get("/{run_id}/messages", response_model=list[RunMessageOut], dependencies=[Depends(verify_api_key)])
async def get_messages(
    run_id: str,
    limit: int = Query(50, le=200),
    cursor: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    return await run_svc.get_run_messages(db, run_id, limit=limit, cursor=cursor)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.get("/{run_id}/events", response_model=list[RunEventSummary], dependencies=[Depends(verify_api_key)])
async def get_events(
    run_id: str,
    phase_id: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await run_svc.get_run_events(db, run_id, phase_id=phase_id, since=since, limit=limit)


@router.get("/{run_id}/events/{event_id}", response_model=RunEventFull, dependencies=[Depends(verify_api_key)])
async def get_event_detail(run_id: str, event_id: str, db: AsyncSession = Depends(get_db)):
    event = await run_svc.get_event_full(db, run_id, event_id)
    return RunEventFull.model_validate(event)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@router.post("/{run_id}/pause", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def pause_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    run = await run_svc.transition(db, run, "paused")
    await run_events.emit(db, run_id, "user_intervention", summary="Run paused")
    await db.commit()
    await db.refresh(run)
    return run


@router.post("/{run_id}/resume", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def resume_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    run = await run_svc.transition(db, run, "running")
    await run_events.emit(db, run_id, "user_intervention", summary="Run resumed")
    await db.commit()
    await db.refresh(run)
    return run


@router.post("/{run_id}/cancel", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def cancel_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    run = await run_svc.transition(db, run, "cancelled")
    await run_events.emit(db, run_id, "user_intervention", summary="Run cancelled")
    await db.commit()
    await db.refresh(run)
    return run


@router.post("/{run_id}/archive", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def archive_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    run = await run_svc.transition(db, run, "archived")
    await db.commit()
    await db.refresh(run)
    return run


# ---------------------------------------------------------------------------
# Method attachment + fork
# ---------------------------------------------------------------------------

@router.post("/{run_id}/attach-method", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def attach_method_route(run_id: str, body: RunAttachMethod, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    run = await run_svc.attach_method(db, run, body.method_id)
    await run_events.emit(
        db, run_id, "user_intervention",
        summary=f"Attached method: {run.method_id}",
    )
    await db.commit()
    await db.refresh(run)
    return run


@router.post("/{run_id}/fork", response_model=RunOut, status_code=201, dependencies=[Depends(verify_api_key)])
async def fork_run(run_id: str, body: RunFork, db: AsyncSession = Depends(get_db)):
    source = await run_svc.get_run(db, run_id)
    forked = await run_svc.fork_run(db, source, body.event_id)
    await db.commit()
    await db.refresh(forked)
    return forked


# ---------------------------------------------------------------------------
# Approval
# ---------------------------------------------------------------------------

@router.post("/{run_id}/approve", response_model=RunOut, dependencies=[Depends(verify_api_key)])
async def approve(run_id: str, body: RunApprovalAction, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    await run_events.emit(
        db, run_id, "approval_gate",
        summary=f"Approval: {body.action}",
        phase_id=body.phase_id,
        payload={"action": body.action, "edit_payload": body.edit_payload},
    )
    if run.state == "awaiting_approval":
        run = await run_svc.transition(db, run, "running")
    await db.commit()
    await db.refresh(run)
    return run


# ---------------------------------------------------------------------------
# SSE stream (no auth — EventSource can't send headers)
# ---------------------------------------------------------------------------

@router.get("/{run_id}/stream")
async def stream_run(run_id: str, request: Request):
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        run = await run_svc.get_run(db, run_id)

    async def generate():
        async for chunk in run_events.stream(run_id):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Legacy lookup
# ---------------------------------------------------------------------------

@router.get("/by-legacy", dependencies=[Depends(verify_api_key)])
async def lookup_by_legacy(
    type: str = Query(..., pattern="^(chat|pipeline|session)$"),
    id: str = Query(...),
):
    return {"detail": "Not yet implemented — see Chunk 12"}
