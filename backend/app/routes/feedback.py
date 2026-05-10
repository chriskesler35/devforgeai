"""Feedback endpoints — collect and summarize user satisfaction ratings."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.feedback import Feedback

import uuid

router = APIRouter(prefix="/v1/feedback", tags=["feedback"], dependencies=[Depends(verify_api_key)])


class FeedbackCreate(BaseModel):
    message_id: str
    conversation_id: Optional[str] = None
    model_id: Optional[str] = None
    rating: int  # 1 = thumbs down, 5 = thumbs up
    feedback_text: Optional[str] = None


class MethodFeedbackCreate(BaseModel):
    method_id: str
    workflow_type: str  # session | pipeline
    rating: str  # excellent | good | ok | poor
    review_text: Optional[str] = None
    session_id: Optional[str] = None
    pipeline_id: Optional[str] = None


METHOD_FEEDBACK_FILE = Path("data/method_feedback.json")
METHOD_FEEDBACK_SCORES = {
    "excellent": 4,
    "good": 3,
    "ok": 2,
    "poor": 1,
}


def _load_method_feedback() -> list[dict]:
    if not METHOD_FEEDBACK_FILE.exists():
        return []
    try:
        return json.loads(METHOD_FEEDBACK_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_method_feedback(rows: list[dict]) -> None:
    METHOD_FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    METHOD_FEEDBACK_FILE.write_text(json.dumps(rows, indent=2), encoding="utf-8")


@router.post("")
async def create_feedback(
    body: FeedbackCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Store user feedback on an AI response."""
    if body.rating not in (1, 5):
        raise HTTPException(status_code=422, detail="Rating must be 1 (thumbs down) or 5 (thumbs up)")

    user = getattr(request.state, "user", {})
    user_id = user.get("id", "anonymous") if isinstance(user, dict) else "anonymous"

    feedback = Feedback(
        id=uuid.uuid4(),
        user_id=user_id,
        message_id=body.message_id,
        conversation_id=body.conversation_id,
        model_id=body.model_id,
        rating=body.rating,
        feedback_text=body.feedback_text,
    )
    db.add(feedback)
    await db.commit()

    return {"id": str(feedback.id), "status": "saved"}


@router.get("")
async def get_feedback_summary(
    model_id: Optional[str] = Query(default=None),
    days: int = Query(default=7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Get feedback summary, optionally filtered by model."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    if model_id:
        result = await db.execute(
            text("""
                SELECT
                    COUNT(*) as total,
                    COUNT(CASE WHEN rating = 5 THEN 1 END) as positive,
                    COUNT(CASE WHEN rating = 1 THEN 1 END) as negative
                FROM feedback
                WHERE model_id = :model_id AND created_at >= :since
            """),
            {"model_id": model_id, "since": since},
        )
        row = result.fetchone()
        total = row[0] if row else 0
        positive = row[1] if row else 0
        negative = row[2] if row else 0

        return {
            "model_id": model_id,
            "total": total,
            "positive": positive,
            "negative": negative,
            "satisfaction_rate": round(positive / total * 100, 1) if total > 0 else 0,
            "period_days": days,
        }

    # All models grouped
    result = await db.execute(
        text("""
            SELECT
                model_id,
                COUNT(*) as total,
                COUNT(CASE WHEN rating = 5 THEN 1 END) as positive,
                COUNT(CASE WHEN rating = 1 THEN 1 END) as negative
            FROM feedback
            WHERE created_at >= :since
            GROUP BY model_id
        """),
        {"since": since},
    )
    rows = result.fetchall()
    return {
        "by_model": [
            {
                "model_id": row[0],
                "total": row[1],
                "positive": row[2],
                "negative": row[3],
                "satisfaction_rate": round(row[2] / row[1] * 100, 1) if row[1] > 0 else 0,
            }
            for row in rows
        ],
        "period_days": days,
    }


@router.post("/methods")
async def create_method_feedback(
    body: MethodFeedbackCreate,
    request: Request,
):
    """Store method/workflow feedback for pattern-2 marketplace and loop closure."""
    method_id = (body.method_id or "").strip().lower()
    if not method_id:
        raise HTTPException(status_code=422, detail="method_id is required")

    workflow_type = (body.workflow_type or "").strip().lower()
    if workflow_type not in {"session", "pipeline"}:
        raise HTTPException(status_code=422, detail="workflow_type must be 'session' or 'pipeline'")

    rating = (body.rating or "").strip().lower()
    if rating not in METHOD_FEEDBACK_SCORES:
        raise HTTPException(status_code=422, detail="rating must be one of: excellent, good, ok, poor")

    user = getattr(request.state, "user", {})
    user_id = user.get("id", "anonymous") if isinstance(user, dict) else "anonymous"

    rows = _load_method_feedback()
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "method_id": method_id,
        "workflow_type": workflow_type,
        "rating": rating,
        "score": METHOD_FEEDBACK_SCORES[rating],
        "review_text": (body.review_text or "").strip() or None,
        "session_id": body.session_id,
        "pipeline_id": body.pipeline_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    rows.append(row)
    _save_method_feedback(rows)
    return {"id": row["id"], "status": "saved"}


@router.get("/methods/summary")
async def get_method_feedback_summary(
    method_id: Optional[str] = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
):
    """Return aggregated method feedback ratings for cards/marketplace views."""
    rows = _load_method_feedback()
    since = datetime.now(timezone.utc) - timedelta(days=days)

    filtered = []
    for row in rows:
        ts_raw = row.get("created_at")
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except Exception:
            continue
        if ts < since:
            continue
        if method_id and str(row.get("method_id") or "").lower() != method_id.lower():
            continue
        filtered.append(row)

    def _aggregate(items: list[dict]) -> dict:
        total = len(items)
        if total == 0:
            return {
                "total": 0,
                "average_score": 0,
                "average_rating": "n/a",
                "excellent": 0,
                "good": 0,
                "ok": 0,
                "poor": 0,
            }
        counts = {"excellent": 0, "good": 0, "ok": 0, "poor": 0}
        score_sum = 0
        for item in items:
            rating = str(item.get("rating") or "").lower()
            if rating in counts:
                counts[rating] += 1
            score_sum += int(item.get("score") or METHOD_FEEDBACK_SCORES.get(rating, 0))
        avg_score = round(score_sum / total, 2)
        avg_rating = (
            "excellent" if avg_score >= 3.5 else
            "good" if avg_score >= 2.5 else
            "ok" if avg_score >= 1.5 else
            "poor"
        )
        return {
            "total": total,
            "average_score": avg_score,
            "average_rating": avg_rating,
            "excellent": counts["excellent"],
            "good": counts["good"],
            "ok": counts["ok"],
            "poor": counts["poor"],
        }

    if method_id:
        return {
            "method_id": method_id,
            **_aggregate(filtered),
            "period_days": days,
        }

    grouped: dict[str, list[dict]] = {}
    for row in filtered:
        key = str(row.get("method_id") or "unknown")
        grouped.setdefault(key, []).append(row)

    return {
        "by_method": [
            {"method_id": key, **_aggregate(items)}
            for key, items in grouped.items()
        ],
        "period_days": days,
    }
