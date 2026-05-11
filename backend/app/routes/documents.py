"""Document generation endpoints.

Exposes a unified document-generation API plus convenience routes that
package application data (conversations, etc.) as downloadable files in
PDF, DOCX, XLSX, PPTX, CSV, HTML, MD, TXT, or JSON.
"""

from __future__ import annotations

import logging
import uuid
from io import BytesIO
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models import Conversation, Message
from app.services import document_generator as docgen

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/documents",
    tags=["documents"],
    dependencies=[Depends(verify_api_key)],
)


class TableSpec(PydanticBaseModel):
    name: Optional[str] = None
    headers: Optional[List[Any]] = None
    rows: Optional[List[List[Any]]] = None


class SectionSpec(PydanticBaseModel):
    heading: Optional[str] = None
    body: Optional[str] = None
    bullets: Optional[List[str]] = None


class SlideSpec(PydanticBaseModel):
    title: Optional[str] = None
    bullets: Optional[List[str]] = None
    notes: Optional[str] = None


class DocumentRequest(PydanticBaseModel):
    format: str
    filename: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    sections: Optional[List[SectionSpec]] = None
    tables: Optional[List[TableSpec]] = None
    slides: Optional[List[SlideSpec]] = None
    data: Optional[Any] = None


def _streaming_response(content: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(content),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(content)),
        },
    )


@router.get("/formats")
async def list_formats():
    """List supported document formats."""
    return {
        "formats": list(docgen.SUPPORTED_FORMATS),
        "media_types": docgen.MEDIA_TYPES,
    }


@router.post("/generate")
async def generate_document(req: DocumentRequest):
    """Generate a document from a structured spec and return it as a download."""
    try:
        spec = req.model_dump(exclude_none=True)
        content, media_type, suffix = docgen.generate(spec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("document generation failed")
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")
    filename = docgen.filename_for(spec, suffix)
    return _streaming_response(content, media_type, filename)


@router.get("/conversations/{conversation_id}/export")
async def export_conversation(
    conversation_id: str,
    format: str = "md",
    db: AsyncSession = Depends(get_db),
):
    """Export a conversation in the requested format."""
    fmt = (format or "md").strip().lower()
    if fmt not in docgen.SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{fmt}'. Supported: {', '.join(docgen.SUPPORTED_FORMATS)}",
        )

    try:
        conv_uuid = uuid.UUID(conversation_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=404, detail="Conversation not found")

    conv = (
        await db.execute(select(Conversation).where(Conversation.id == conv_uuid))
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    rows = (
        await db.execute(
            select(Message)
            .where(Message.conversation_id == conv_uuid)
            .order_by(Message.created_at)
        )
    ).scalars().all()

    messages = [
        {
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat() if getattr(m, "created_at", None) else None,
        }
        for m in rows
    ]
    title = conv.title or f"Conversation {conversation_id[:8]}"

    try:
        data, media_type, _suffix, filename = docgen.render_conversation(title, messages, fmt)
    except Exception as e:
        logger.exception("conversation export failed")
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")

    return _streaming_response(data, media_type, filename)
