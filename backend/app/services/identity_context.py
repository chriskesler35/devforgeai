"""Shared identity/soul/user context builder.

Used by chat, workbench, telegram bot, and any other surface where the AI
interacts with the user. Ensures consistent identity across all interactions.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent.parent.parent / "data"


def build_identity_context(include_method: bool = True, include_memory: bool = False) -> str:
    """Build a unified system prompt containing the AI identity and user context.

    Reads from:
      - data/soul.md       → AI personality, voice, values
      - data/user.md       → user profile, preferences, context
      - data/identity.md   → AI name, role, behavioral directives
      - Active method      → BMAD/GSD/etc system prompt (if include_method)
      - data/context/MEMORY.md → distilled long-term memory (if include_memory)

    Returns a single string ready to prepend as a system message.
    Returns empty string if no identity files exist.
    """
    parts = []

    # AI identity (soul.md)
    try:
        soul = _DATA_DIR / "soul.md"
        if soul.exists() and soul.stat().st_size > 10:
            parts.append(f"# AI Identity (Soul)\n{soul.read_text(encoding='utf-8')}")
    except Exception as e:
        logger.debug(f"Could not read soul.md: {e}")

    # Extended AI identity directives
    try:
        identity = _DATA_DIR / "identity.md"
        if identity.exists() and identity.stat().st_size > 10:
            parts.append(f"# AI Identity Directives\n{identity.read_text(encoding='utf-8')}")
    except Exception as e:
        logger.debug(f"Could not read identity.md: {e}")

    # User profile
    try:
        user = _DATA_DIR / "user.md"
        if user.exists() and user.stat().st_size > 10:
            parts.append(f"# About the User\n{user.read_text(encoding='utf-8')}")
    except Exception as e:
        logger.debug(f"Could not read user.md: {e}")

    # Active development method (stack-aware)
    if include_method:
        try:
            from app.routes.methods import (
                _load_state as _load_method_state,
                BUILT_IN_METHODS,
                _build_stack_prompt,
            )
            state = _load_method_state()
            method_settings = state.get("method_settings") or {}
            stack = state.get("active_stack") or []
            active_id = state.get("active_method", "standard")

            # Per-method chat-injection toggle: methods can opt out of being
            # injected into chat (set method_settings[<id>].chat_injection = False).
            def _injects(mid: str) -> bool:
                cfg = method_settings.get(mid) or {}
                return cfg.get("chat_injection", True) is not False

            method_prompt = ""
            if len(stack) > 1:
                allowed = [m for m in stack if _injects(m)]
                method_prompt = _build_stack_prompt(allowed)
            else:
                if _injects(active_id):
                    m = BUILT_IN_METHODS.get(active_id, {})
                    method_prompt = m.get("system_prompt", "") or ""

            if method_prompt and method_prompt.strip():
                parts.append(method_prompt.strip())
        except Exception as e:
            logger.debug(f"Could not load method prompt: {e}")

    # Long-term distilled memory
    if include_memory:
        try:
            memory = _DATA_DIR / "context" / "MEMORY.md"
            if memory.exists() and memory.stat().st_size > 10:
                content = memory.read_text(encoding='utf-8')
                # Cap at ~6KB to avoid blowing up context
                if len(content) > 6000:
                    content = content[:6000] + "\n… (truncated)"
                parts.append(f"# Long-term Memory\n{content}")
        except Exception as e:
            logger.debug(f"Could not read MEMORY.md: {e}")

    if not parts:
        return ""

    return "\n\n---\n\n".join(parts)


async def build_identity_context_async(
    db=None,
    include_method: bool = True,
    include_memory: bool = False,
    include_custom_methods: bool = True,
) -> str:
    """Async variant that additionally surfaces active custom methods (DB lookup).

    Used by chat surfaces where an AsyncSession is already in scope. Falls back
    to the sync implementation when no DB or custom methods are requested.
    """
    base = build_identity_context(include_method=include_method, include_memory=include_memory)

    if not include_custom_methods or db is None:
        return base

    try:
        from sqlalchemy import select as _select
        from app.models.custom_method import CustomMethod as _CM

        result = await db.execute(_select(_CM).where(_CM.is_active == True))  # noqa: E712
        customs = result.scalars().all()
    except Exception as e:
        logger.debug(f"Custom method enrichment skipped: {e}")
        return base

    if not customs:
        return base

    lines = ["# Custom Methods Available"]
    for cm in customs:
        phase_names = ", ".join((p.get("name") or "?") for p in (cm.phases or []))
        desc = (cm.description or "").strip()
        if desc:
            lines.append(f"- **{cm.name}** — {desc} (phases: {phase_names})")
        else:
            lines.append(f"- **{cm.name}** (phases: {phase_names})")
    custom_block = "\n".join(lines)

    if base:
        return f"{base}\n\n---\n\n{custom_block}"
    return custom_block
