"""Run API routes — /v1/runs/* CRUD, lifecycle, and SSE stream."""

import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, Request, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models import Model, Provider
from app.schemas.run import (
    RunCreate, RunUpdate, RunOut, RunDetailOut,
    RunMessageIn, RunMessageOut,
    RunAttachMethod, RunFork, RunApprovalAction,
    RunPhaseOut, RunEventSummary, RunEventFull,
    RunEditRetry, RunSwapModel,
)
from app.services import runs as run_svc
from app.services import run_events
from app.services.model_client import model_client
from app.services.runtime_model_resolver import (
    Ready as RuntimeReady,
    NeedsLiveProbe as RuntimeNeedsLiveProbe,
    resolve_model_for_runtime,
)

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
        agent_id=body.agent_id,
        model_ref=body.model_ref,
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
        model_ref=body.model_ref,
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

    # --- Slash commands ---
    slash_result = await run_svc.handle_slash_command(db, run, body.content)
    if slash_result:
        await db.commit()
        return slash_result

    # --- Store user message ---
    msg = await run_events.record_message(
        db, run_id,
        role=body.role,
        content=body.content,
        image_url=body.image_url,
    )
    await db.commit()
    await db.refresh(msg)

    # --- LLM call (only for user messages with a model selected) ---
    model_ref = (run.extra_data or {}).get("model_ref")
    if body.role != "user" or not model_ref:
        return msg

    # Resolve model + provider
    resolved = await resolve_model_for_runtime(db, model_ref, intent="chat")
    if not isinstance(resolved, (RuntimeReady, RuntimeNeedsLiveProbe)):
        # Model not reachable — store an error message and return the user msg
        error_text = getattr(resolved, "user_message", "Model is unavailable.")
        await run_events.record_message(db, run_id, role="assistant", content=f"⚠️ {error_text}")
        await db.commit()
        return msg

    llm_model: Model = resolved.model
    llm_provider: Provider = resolved.provider

    # Build chat-completions message list from Run history
    all_messages = await run_svc.get_run_messages(db, run_id, limit=100)
    chat_messages = []
    for m in all_messages:
        chat_messages.append({"role": m.role, "content": m.content})

    # Transition to running
    if run.state == "awaiting_input":
        try:
            run = await run_svc.transition(db, run, "running")
        except Exception:
            pass  # If transition fails (e.g. already running), continue anyway

    # Emit model_request event
    await run_events.emit(
        db, run_id, "model_request",
        summary=f"Calling {llm_model.model_id}",
        payload={"model_ref": model_ref, "message_count": len(chat_messages)},
    )
    await db.commit()

    # Call LLM with image generation tool available
    from app.services.run_image_gen import IMAGE_TOOL_SCHEMA, handle_image_tool_call

    t0 = time.time()
    assistant_text = ""
    tokens_in = 0
    tokens_out = 0
    image_generated = False
    try:
        resp_text, tool_calls, in_tok, out_tok = await asyncio.wait_for(
            model_client.call_model_with_tools(
                model=llm_model,
                provider=llm_provider,
                messages=chat_messages,
                tools=[IMAGE_TOOL_SCHEMA],
            ),
            timeout=120,
        )
        assistant_text = resp_text
        tokens_in = in_tok
        tokens_out = out_tok

        # Handle image generation tool calls
        for tc in tool_calls:
            if tc["name"] == "generate_image":
                image_generated = True
                tool_result = await handle_image_tool_call(
                    db, run_id, tc["arguments"],
                )
                # If the LLM also produced text, store it separately
                if assistant_text.strip():
                    await run_events.record_message(
                        db, run_id, role="assistant",
                        content=assistant_text,
                    )
                # The image message was already stored by handle_image_tool_call
                assistant_text = ""  # Don't store again below

    except asyncio.TimeoutError:
        assistant_text = "⚠️ The model did not respond within 120 seconds."
        logger.warning("LLM timeout for run %s model %s", run_id, model_ref)
    except Exception as exc:
        assistant_text = f"⚠️ Model error: {exc}"
        logger.warning("LLM error for run %s: %s", run_id, exc)

    duration_ms = int((time.time() - t0) * 1000)

    # Store assistant text response (if not already handled by tool call)
    if assistant_text:
        await run_events.record_message(
            db, run_id, role="assistant", content=assistant_text,
        )

    # Emit model_response event with metrics
    cost_usd = None
    if tokens_in or tokens_out:
        try:
            cost_usd = model_client.estimate_cost(tokens_in, tokens_out, llm_model)
        except Exception:
            pass

    summary = "Image generated" if image_generated else (assistant_text or "")[:120]
    await run_events.emit(
        db, run_id, "model_response",
        summary=summary,
        duration_ms=duration_ms,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
        payload={"model_id": llm_model.model_id, "provider": llm_provider.name},
    )

    # Transition back to awaiting_input
    if run.state == "running":
        try:
            run = await run_svc.transition(db, run, "awaiting_input")
        except Exception:
            pass

    await db.commit()
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


@router.delete("/{run_id}", status_code=204, dependencies=[Depends(verify_api_key)])
async def delete_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    await run_svc.delete_run(db, run)
    await db.commit()


@router.post("/bulk-delete", status_code=200, dependencies=[Depends(verify_api_key)])
async def bulk_delete_runs(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple runs by ID list, or all runs matching a state filter.

    Body: { "ids": [...] }  — delete specific runs
      or: { "state": "completed" }  — delete all runs in that state
      or: { "terminal": true }  — delete all completed/failed/cancelled runs
    """
    deleted = 0

    if "ids" in body and isinstance(body["ids"], list):
        for rid in body["ids"]:
            try:
                run = await run_svc.get_run(db, str(rid))
                await run_svc.delete_run(db, run)
                deleted += 1
            except Exception:
                pass

    elif body.get("terminal"):
        runs = await run_svc.list_runs(db, limit=200)
        for run in runs:
            if run.state in run_svc.TERMINAL_STATES:
                await run_svc.delete_run(db, run)
                deleted += 1

    elif "state" in body:
        runs = await run_svc.list_runs(db, states=[body["state"]], limit=200)
        for run in runs:
            await run_svc.delete_run(db, run)
            deleted += 1

    await db.commit()
    return {"deleted": deleted}


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
# Power tools
# ---------------------------------------------------------------------------

@router.post("/{run_id}/events/{event_id}/edit-retry", response_model=RunEventSummary, dependencies=[Depends(verify_api_key)])
async def edit_retry(run_id: str, event_id: str, body: RunEditRetry, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    event = await run_svc.edit_retry(db, run, event_id, body.new_prompt)
    await db.commit()
    await db.refresh(event)
    return event


@router.post("/{run_id}/phases/{phase_id}/swap-model", response_model=RunPhaseOut, dependencies=[Depends(verify_api_key)])
async def swap_model(run_id: str, phase_id: str, body: RunSwapModel, db: AsyncSession = Depends(get_db)):
    run = await run_svc.get_run(db, run_id)
    phase = await run_svc.swap_model(db, run, phase_id, body.model_id)
    await db.commit()
    await db.refresh(phase)
    return phase


# ---------------------------------------------------------------------------
# SSE stream (no auth — EventSource can't send headers)
# ---------------------------------------------------------------------------

@router.get("/{run_id}/stream")
async def stream_run(run_id: str, request: Request):
    from app.database import AsyncSessionLocal
    # Validate the run exists before opening an SSE stream — `get_run`
    # raises 404 when missing, which surfaces to the client instead of
    # producing a hanging empty stream.
    async with AsyncSessionLocal() as db:
        await run_svc.get_run(db, run_id)

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
    db: AsyncSession = Depends(get_db),
):
    run, created = await run_svc.get_or_create_companion_run(db, type, id)
    await db.commit()
    from starlette.responses import JSONResponse
    return JSONResponse(
        content={"run_id": run.id, "created": created},
        headers={"Cache-Control": "private, max-age=3600"},
    )
