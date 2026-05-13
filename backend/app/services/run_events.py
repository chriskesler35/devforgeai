"""Run event emitter + SSE fan-out.

In-process pub/sub: each run_id maps to a set of asyncio.Queue subscribers.
The emitter pushes serialized events to every queue. SSE consumers register
a queue via stream().
"""

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, AsyncIterator, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import RunEvent, RunMessage, EVENT_KINDS

logger = logging.getLogger(__name__)

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

SSE_PING_INTERVAL = 25


def _json_default(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Not serializable: {type(obj)}")


def _serialize(data: dict) -> str:
    return json.dumps(data, default=_json_default)


# ---------------------------------------------------------------------------
# Emit
# ---------------------------------------------------------------------------

async def emit(
    db: AsyncSession,
    run_id: str,
    kind: str,
    summary: str,
    *,
    payload: dict[str, Any] | None = None,
    phase_id: str | None = None,
    duration_ms: int | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    cost_usd: float | None = None,
) -> RunEvent:
    if kind not in EVENT_KINDS:
        logger.warning("Unknown event kind '%s' for run %s — recording anyway", kind, run_id)

    event = RunEvent(
        id=str(uuid.uuid4()),
        run_id=run_id,
        phase_id=phase_id,
        kind=kind,
        summary=summary,
        payload=payload or {},
        duration_ms=duration_ms,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
    )
    db.add(event)
    await db.flush()

    frame = {
        "type": "run_event",
        "data": event.to_summary_dict(),
    }
    _fanout(run_id, frame)
    return event


# ---------------------------------------------------------------------------
# Message persistence + fan-out
# ---------------------------------------------------------------------------

async def record_message(
    db: AsyncSession,
    run_id: str,
    role: str,
    content: str,
    image_url: str | None = None,
) -> RunMessage:
    msg = RunMessage(
        id=str(uuid.uuid4()),
        run_id=run_id,
        role=role,
        content=content,
        image_url=image_url,
    )
    db.add(msg)
    await db.flush()

    frame = {
        "type": "run_message",
        "data": msg.to_dict(),
    }
    _fanout(run_id, frame)

    if role == "assistant":
        await emit(
            db, run_id, "model_response",
            summary=content[:120],
            payload={"content": content},
        )

    return msg


# ---------------------------------------------------------------------------
# Pub/sub helpers
# ---------------------------------------------------------------------------

def _fanout(run_id: str, frame: dict) -> None:
    serialized = _serialize(frame)
    dead: list[asyncio.Queue] = []
    for q in _subscribers.get(run_id, set()):
        try:
            q.put_nowait(serialized)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers[run_id].discard(q)


def subscribe(run_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=512)
    _subscribers[run_id].add(q)
    return q


def unsubscribe(run_id: str, q: asyncio.Queue) -> None:
    _subscribers[run_id].discard(q)
    if not _subscribers[run_id]:
        del _subscribers[run_id]


# ---------------------------------------------------------------------------
# SSE stream
# ---------------------------------------------------------------------------

async def stream(run_id: str) -> AsyncIterator[str]:
    q = subscribe(run_id)
    try:
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=SSE_PING_INTERVAL)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    except (asyncio.CancelledError, GeneratorExit):
        pass
    finally:
        unsubscribe(run_id, q)
