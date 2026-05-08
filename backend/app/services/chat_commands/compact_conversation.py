"""Conversation compaction — summarise and trim long conversation histories.

Triggered by:
  - User typing /compact in chat
  - Automatic trigger when a CONTEXT_OVERFLOW error is detected

Strategy:
  1. Load all messages for the conversation from the DB.
  2. Call the active model to produce a concise summary of the full history.
  3. Delete all existing messages for the conversation.
  4. Insert a single system message containing the summary (acts as compressed history).
  5. Optionally keep the last N user/assistant turns verbatim after the summary
     (controlled by DEVFORGEAI_COMPACT_KEEP_TURNS, default 2).
  6. Update conversation.message_count.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.conversation import Conversation, Message

logger = logging.getLogger(__name__)


def _compact_keep_turns() -> int:
    raw = (os.getenv("DEVFORGEAI_COMPACT_KEEP_TURNS", "2") or "2").strip()
    try:
        return max(0, min(int(raw), 20))
    except Exception:
        return 2


async def compact_conversation(
    conversation_id: str,
    db: AsyncSession,
    *,
    model=None,
    provider=None,
    force: bool = False,
) -> str:
    """Summarise and trim a conversation.

    Returns a human-readable status message for the chat UI.
    """
    from app.database import AsyncSessionLocal

    # Load messages in a fresh session to avoid detached-instance issues.
    async with AsyncSessionLocal() as fresh_db:
        msg_result = await fresh_db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
        )
        messages = list(msg_result.scalars().all())

    if not messages:
        return "This conversation has no messages to compact."

    if len(messages) <= 4 and not force:
        return (
            f"This conversation only has {len(messages)} messages — "
            "compaction isn't needed yet. Use `/compact` to force it anyway."
        )

    keep_turns = _compact_keep_turns()

    # Build a plain-text transcript for summarisation.
    transcript_lines = []
    for msg in messages:
        role = (msg.role or "user").upper()
        content = (msg.content or "").strip()
        if content:
            transcript_lines.append(f"{role}: {content[:4000]}")  # cap each turn at 4K chars
    transcript = "\n\n".join(transcript_lines)

    # Call the model for a summary if we have one available.
    summary_text = None
    if model and provider:
        try:
            from app.services import model_client as _mc
            summary_prompt = [
                {
                    "role": "system",
                    "content": (
                        "You are a conversation summariser. The user will provide a full chat transcript. "
                        "Produce a dense, structured summary that preserves: key decisions made, facts established, "
                        "files mentioned or created, tasks completed, and any open questions. "
                        "Write in third-person past tense. Be concise — aim for 200–500 words."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Summarise this conversation:\n\n{transcript}",
                },
            ]
            resp = await _mc.call_model(
                model=model,
                provider=provider,
                messages=summary_prompt,
                stream=False,
                max_tokens=1024,
                temperature=0.3,
            )
            if hasattr(resp, "choices") and resp.choices:
                summary_text = (resp.choices[0].message.content or "").strip()
        except Exception as exc:
            logger.warning("Compact: failed to generate summary with model: %s", exc)

    if not summary_text:
        # Fallback: extractive summary — first line of each message, capped.
        lines = []
        for msg in messages:
            first_line = (msg.content or "").split("\n")[0].strip()[:200]
            if first_line:
                lines.append(f"[{msg.role}] {first_line}")
        summary_text = (
            "Conversation history summary (extractive):\n"
            + "\n".join(lines[:40])
        )

    # Identify the messages to keep verbatim (last keep_turns user+assistant pairs).
    keep_ids: set[str] = set()
    if keep_turns > 0:
        # Walk backwards and collect up to keep_turns pairs.
        pairs_kept = 0
        for msg in reversed(messages):
            if msg.role in ("user", "assistant"):
                keep_ids.add(str(msg.id))
                if msg.role == "user":
                    pairs_kept += 1
                    if pairs_kept >= keep_turns:
                        break

    kept_messages = [m for m in messages if str(m.id) in keep_ids]

    # Now rewrite the conversation in a fresh session.
    async with AsyncSessionLocal() as fresh_db:
        # Delete all existing messages for this conversation.
        await fresh_db.execute(
            delete(Message).where(Message.conversation_id == conversation_id)
        )

        # Insert the summary as a system message.
        summary_msg = Message(
            conversation_id=conversation_id,
            role="system",
            content=f"[CONVERSATION COMPACTED]\n\n{summary_text}",
        )
        fresh_db.add(summary_msg)

        # Re-insert the kept recent messages in order.
        for msg in kept_messages:
            fresh_db.add(Message(
                conversation_id=conversation_id,
                role=msg.role,
                content=msg.content,
                model_used=str(msg.model_used) if msg.model_used else None,
                tokens_in=msg.tokens_in,
                tokens_out=msg.tokens_out,
            ))

        # Update conversation message count.
        conv_result = await fresh_db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = conv_result.scalar_one_or_none()
        if conv:
            conv.message_count = 1 + len(kept_messages)

        await fresh_db.commit()

    deleted_count = len(messages) - len(kept_messages)
    logger.info(
        "compact_conversation conv=%s: removed=%d kept=%d summary_len=%d",
        conversation_id[:8],
        deleted_count,
        len(kept_messages),
        len(summary_text),
    )

    return (
        f"**Conversation compacted.** "
        f"Removed {deleted_count} message(s) and replaced them with a summary. "
        f"Kept {len(kept_messages)} most recent message(s) verbatim.\n\n"
        f"**Summary:**\n{summary_text}"
    )
