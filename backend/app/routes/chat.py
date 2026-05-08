"""Chat completion endpoints."""

import uuid
import json
import time
import asyncio
import os
import re
import socket
import subprocess
from pathlib import Path
from typing import Any, Dict
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.dependencies import get_memory
from app.models import Conversation, Message, Model, Provider
from app.schemas import ChatCompletionRequest
from app.services import PersonaResolver, Router, model_client
from app.services.memory_context import MemoryContext
from app.services.provider_credentials import has_provider_api_key
from app.middleware.auth import verify_api_key
from app.middleware.rate_limit import check_rate_limit
import logging

logger = logging.getLogger(__name__)
# Dedicated issues logger — also writes to logs/llm-issues.log
_issues_log = logging.getLogger("llm.issues")


def _log_llm_issue(issue_type: str, model_id: str, conv_id: str, detail: str, extra: str = "") -> None:
    """Emit a structured WARNING to both the main logger and llm-issues.log."""
    msg = f"[{issue_type}] model={model_id} conv={conv_id[:8] if conv_id else '?'} | {detail}"
    if extra:
        msg += f" | {extra}"
    logger.warning(msg)
    _issues_log.warning(msg)


router = APIRouter(prefix="/v1", tags=["chat"], dependencies=[Depends(verify_api_key), Depends(check_rate_limit)])

# Ephemeral per-conversation workflow gating state.
# Keyed by conversation_id string.
_workflow_session_state: Dict[str, Dict[str, Any]] = {}
_LOCAL_MODEL_PROVIDERS = {"ollama", "local", "lm-studio", "lmstudio", "llamacpp"}
_MODEL_VRAM_MAP_MB: dict[str, int] = {
    "0.6b": 800,
    "1b": 1200,
    "1.5b": 1500,
    "3b": 2500,
    "7b": 6500,
    "8b": 7500,
    "13b": 9000,
    "14b": 10000,
    "32b": 21000,
    "33b": 22000,
    "34b": 23000,
    "70b": 45000,
    "llama3.1:8b": 7500,
    "qwen2.5-coder:7b": 6500,
    "qwen2.5-coder:14b": 10000,
    "qwen2.5-coder:32b": 21000,
}


def _is_cloud_model(model: Model | None, provider: Provider | None) -> bool:
    if not model:
        return False
    model_id = (model.model_id or "").strip().lower()
    if model_id.endswith(":cloud"):
        return True
    provider_name = (provider.name or "").strip().lower() if provider else ""
    return provider_name not in _LOCAL_MODEL_PROVIDERS


def _estimate_model_vram_mb(model_id: str) -> int:
    normalized = (model_id or "").strip().lower()
    if not normalized:
        return 0
    if normalized.endswith(":cloud"):
        return 0
    if normalized in _MODEL_VRAM_MAP_MB:
        return _MODEL_VRAM_MAP_MB[normalized]
    for token, vram_mb in _MODEL_VRAM_MAP_MB.items():
        if token in normalized:
            return vram_mb
    return 5000


def _get_total_free_vram_mb() -> int | None:
    """Return aggregate free VRAM from nvidia-smi, or None if unavailable."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    free_values: list[int] = []
    for line in (result.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            free_values.append(int(line))
        except Exception:
            continue

    if not free_values:
        return None
    return sum(free_values)


def _vram_guard_enabled() -> bool:
    raw = (os.getenv("DEVFORGEAI_VRAM_GUARD_ENABLED", "true") or "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _evaluate_vram_fitness(model: Model | None, provider: Provider | None) -> tuple[bool, str]:
    """Block local model execution when free VRAM is insufficient."""
    if not model or not provider or not _vram_guard_enabled():
        return True, ""

    provider_name = (provider.name or "").lower().strip()
    if provider_name not in _LOCAL_MODEL_PROVIDERS:
        return True, ""

    model_id = (model.model_id or "").strip()
    if model_id.lower().endswith(":cloud"):
        return True, ""

    required_mb = _estimate_model_vram_mb(model_id)
    if required_mb <= 0:
        return True, ""

    free_mb = _get_total_free_vram_mb()
    if free_mb is None:
        return False, (
            f"Cannot verify GPU VRAM for local model '{model_id}'. "
            "Cloud fallback required to avoid local OOM risk."
        )

    headroom_raw = (os.getenv("DEVFORGEAI_VRAM_HEADROOM_RATIO", "1.10") or "1.10").strip()
    try:
        headroom_ratio = float(headroom_raw)
    except Exception:
        headroom_ratio = 1.10
    if headroom_ratio < 1.0:
        headroom_ratio = 1.0

    needed_with_headroom = int(required_mb * headroom_ratio)
    if free_mb < needed_with_headroom:
        return False, (
            f"Local VRAM check failed for '{model_id}': requires about {needed_with_headroom} MB "
            f"(including headroom), only {free_mb} MB free."
        )
    return True, ""


def _tool_loop_max_rounds() -> int:
    """Configurable upper bound for model->tool->model rounds per request."""
    raw = (os.getenv("DEVFORGEAI_TOOL_LOOP_MAX_ROUNDS", "12") or "12").strip()
    try:
        value = int(raw)
    except Exception:
        value = 12
    return max(1, min(value, 40))


def _tool_loop_timeout_seconds() -> int:
    """Configurable timeout for each model call in the tool loop."""
    raw = (os.getenv("DEVFORGEAI_TOOL_LOOP_TIMEOUT_SECONDS", "60") or "60").strip()
    try:
        value = int(raw)
    except Exception:
        value = 60
    return max(15, min(value, 300))


def _chat_completion_timeout_seconds() -> int:
    """Base timeout for non-tool single model calls."""
    raw = (os.getenv("DEVFORGEAI_CHAT_TIMEOUT_SECONDS", "45") or "45").strip()
    try:
        value = int(raw)
    except Exception:
        value = 45
    return max(20, min(value, 600))


def _adaptive_model_timeout_seconds(model: Model | None, provider: Provider | None, *, base: int) -> int:
    """Raise timeout ceiling for local/Ollama workloads that may run longer."""
    if not model or not provider:
        return base

    provider_name = (provider.name or "").lower().strip()
    if provider_name not in _LOCAL_MODEL_PROVIDERS and provider_name != "ollama":
        return base

    model_id = (model.model_id or "").strip().lower()
    if model_id.endswith(":cloud"):
        raw = (os.getenv("DEVFORGEAI_OLLAMA_CLOUD_TIMEOUT_SECONDS", "360") or "360").strip()
        try:
            cloud_timeout = int(raw)
        except Exception:
            cloud_timeout = 360
        return max(base, max(30, min(cloud_timeout, 600)))

    raw = (os.getenv("DEVFORGEAI_LOCAL_MODEL_TIMEOUT_SECONDS", "180") or "180").strip()
    try:
        local_timeout = int(raw)
    except Exception:
        local_timeout = 180
    return max(base, max(30, min(local_timeout, 600)))


def _model_supports_tools(model, provider) -> bool:
    """All models — cloud and local — have full tool/function-calling access."""
    return True


def _can_connect_to_base_url(base_url: str | None, timeout: float = 0.35) -> bool:
    if not base_url:
        return False
    try:
        parsed = urlparse(base_url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not host:
            return False
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _provider_is_usable(provider: Provider | None) -> bool:
    if not provider or provider.is_active is False:
        return False
    provider_name = (provider.name or "").lower().strip()
    if provider_name in _LOCAL_MODEL_PROVIDERS:
        return _can_connect_to_base_url(provider.api_base_url)
    return has_provider_api_key(provider_name)


def _evaluate_model_connectivity(model: Model | None, provider: Provider | None) -> tuple[bool, str]:
    if not model:
        return False, "No model is configured."
    if not provider:
        return False, f"Provider missing for model '{model.model_id}'."
    if model.is_active is False:
        return False, f"Model '{model.model_id}' is disabled."
    if (model.validation_status or "unverified") != "validated":
        return False, (
            f"Model '{model.model_id}' is not live-validated "
            f"(status: {model.validation_status or 'unverified'})."
        )
    if provider.is_active is False:
        return False, f"Provider '{provider.name}' is disabled."
    if not _provider_is_usable(provider):
        provider_name = (provider.name or "").lower().strip()
        if provider_name == "github-copilot":
            return False, (
                "GitHub Copilot is not connected. Reconnect GitHub in Settings and ensure "
                "your account has an active Copilot subscription."
            )
        if provider_name in _LOCAL_MODEL_PROVIDERS:
            return False, f"Local provider '{provider.name}' is unreachable at {provider.api_base_url}."
        return False, f"Provider '{provider.name}' has no usable live credentials."
    return True, ""


async def _find_recovery_model(db: AsyncSession, excluded_model_ids: set[str] | None = None) -> tuple[Model | None, Provider | None]:
    excluded = excluded_model_ids or set()
    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.is_active == True)
        .where(Model.validation_status == "validated")
        .order_by(Model.validated_at.desc().nulls_last(), Model.created_at.desc())
    )
    for model, provider in result.all():
        if str(model.id) in excluded:
            continue
        ok, _reason = _evaluate_model_connectivity(model, provider)
        if ok:
            return model, provider
    return None, None


async def _find_cloud_recovery_model(
    db: AsyncSession,
    excluded_model_ids: set[str] | None = None,
) -> tuple[Model | None, Provider | None]:
    """Find a validated, connected cloud model for safe fallback."""
    excluded = excluded_model_ids or set()
    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.is_active == True)
        .where(Model.validation_status == "validated")
        .order_by(Model.validated_at.desc().nulls_last(), Model.created_at.desc())
    )
    for model, provider in result.all():
        if str(model.id) in excluded:
            continue
        if not _is_cloud_model(model, provider):
            continue
        ok, _reason = _evaluate_model_connectivity(model, provider)
        if ok:
            return model, provider
    return None, None


def _get_workflow_state(conversation_id: str) -> Dict[str, Any]:
    state = _workflow_session_state.get(conversation_id)
    if state is None:
        state = {
            "chat_only": False,              # user said scope does NOT warrant a project
            "scope_prompt_pending": False,   # awaiting yes/no for "project or regular chat?"
            "pending_trigger": None,         # cached trigger match while waiting for yes/no
        }
        _workflow_session_state[conversation_id] = state
    return state


def _system_completion(
    *,
    content: str,
    conversation_id: str,
    actual_model: str,
    workflow_trigger: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    modelmesh: Dict[str, Any] = {
        "persona_used": "system",
        "actual_model": actual_model,
        "estimated_cost": 0.0,
        "provider": "system",
    }
    if workflow_trigger is not None:
        modelmesh["workflow_trigger"] = workflow_trigger

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "conversation_id": conversation_id,
        "model": "system",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": content,
            },
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
        "modelmesh": modelmesh,
    }


def _extract_text_tool_calls(response_text: str) -> list[dict]:
    """Best-effort parse for providers that emit tool JSON as plain text.

    Some wrappers/models return tool directives in assistant text instead of
    native ``message.tool_calls`` objects. This parser recovers calls from
    common JSON forms so backend can still execute the loop.
    """
    text = (response_text or "").strip()
    if not text:
        return []

    candidates: list[str] = [text]

    # Extract fenced code blocks (```json ... ```) as parse candidates.
    for m in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
        block = (m.group(1) or "").strip()
        if block:
            candidates.append(block)

    # Extract inline object containing "tool_calls" (prefer wider greedy match).
    for m in re.finditer(r"(\{[\s\S]*\"tool_calls\"[\s\S]*\})", text, flags=re.IGNORECASE):
        obj_txt = (m.group(1) or "").strip()
        if obj_txt:
            candidates.append(obj_txt)

    # If prose wraps JSON, try first '{' to last '}' span as candidate.
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        span = text[first_brace:last_brace + 1].strip()
        if span:
            candidates.append(span)

    def _parse_call_item(item: Any) -> dict | None:
        if not isinstance(item, dict):
            return None

        call_id = str(item.get("id") or f"call_{uuid.uuid4().hex[:8]}")
        fn_block = item.get("function") if isinstance(item.get("function"), dict) else {}
        name = str(
            fn_block.get("name")
            or item.get("name")
            or item.get("tool")
            or item.get("tool_name")
            or ""
        ).strip()
        raw_args = fn_block.get("arguments", item.get("arguments", item.get("args", {})))

        if isinstance(raw_args, str):
            args = {}
            candidate = raw_args.strip()

            # Some providers double-escape function arguments as a JSON string
            # inside another JSON string. Decode in a short bounded loop.
            for _ in range(3):
                try:
                    decoded = json.loads(candidate)
                except Exception:
                    break

                if isinstance(decoded, dict):
                    args = decoded
                    break
                if isinstance(decoded, str):
                    candidate = decoded.strip()
                    continue
                break

            # Fallback: unescape common backslash-escaped quote form.
            if not args and isinstance(candidate, str):
                unescaped = candidate.replace('\\"', '"')
                try:
                    decoded = json.loads(unescaped)
                    if isinstance(decoded, dict):
                        args = decoded
                except Exception:
                    pass
        elif isinstance(raw_args, dict):
            args = raw_args
        else:
            args = {}

        if not name:
            return None
        return {"id": call_id, "name": name, "arguments": args}

    for cand in candidates:
        try:
            payload = json.loads(cand)
        except Exception:
            continue

        parsed: list[dict] = []
        if isinstance(payload, dict):
            raw_calls = payload.get("tool_calls")
            if isinstance(raw_calls, list):
                for item in raw_calls:
                    parsed_item = _parse_call_item(item)
                    if parsed_item:
                        parsed.append(parsed_item)
            else:
                parsed_item = _parse_call_item(payload)
                if parsed_item:
                    parsed.append(parsed_item)
        elif isinstance(payload, list):
            for item in payload:
                parsed_item = _parse_call_item(item)
                if parsed_item:
                    parsed.append(parsed_item)

        if parsed:
            return parsed

    return []


_KNOWN_TOOL_NAMES = {
    "read_file", "read_local_file", "write_local_file", "write_file",
    "list_dir", "run_shell", "install_package", "web_fetch", "convert_media",
}


def _normalize_tool_calls(response_text: str, tool_calls: list[dict] | None, conv_id: str = "", model_id: str = "") -> list[dict]:
    """Return native tool_calls, or fallback parsed calls from assistant text."""
    if tool_calls:
        return tool_calls
    parsed = _extract_text_tool_calls(response_text)
    if parsed:
        logger.info("Recovered %d text-mode tool call(s) from assistant response", len(parsed))
        return parsed

    # Parser-miss heuristic: response contains tool-call-shaped text but parsing failed.
    # Common cause: model returned truncated JSON (hit max_tokens mid-write), or embedded
    # the tool call in prose with surrounding text the JSON parser couldn't isolate.
    text = response_text or ""
    if text and any(f'"name": "{t}"' in text or f'"name":"{t}"' in text for t in _KNOWN_TOOL_NAMES):
        # Detect likely truncation: response ends before closing braces
        likely_truncated = text.rstrip()[-1:] not in ("}", "]")
        _log_llm_issue(
            "TOOL_PARSE_MISS",
            model_id or "unknown",
            conv_id,
            "Response contained a known tool name but the call was not parsed/executed. "
            + ("Response appears TRUNCATED (may have hit max_tokens — increase limit or reduce prompt size)."
               if likely_truncated else
               "Response was not truncated; model may have formatted the call incorrectly."),
            f"resp_len={len(text)} ends_with={repr(text.rstrip()[-20:])}",
        )
    return []


def _canonicalize_tool_calls(tool_calls: list[dict]) -> list[dict]:
    """Normalize tool calls to stable id/name/arguments fields."""
    normalized: list[dict] = []
    for tc in tool_calls or []:
        call_id = str((tc or {}).get("id") or f"call_{uuid.uuid4().hex[:8]}")
        name = str((tc or {}).get("name") or "").strip()
        args = (tc or {}).get("arguments", {}) or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        if not isinstance(args, dict):
            args = {}
        if not name:
            continue
        normalized.append({"id": call_id, "name": name, "arguments": args})
    return normalized


def _tool_message_content(result: dict) -> str:
    """Serialize tool result as compact JSON for role=tool message content."""
    payload: Dict[str, Any] = {
        "success": bool((result or {}).get("success", False)),
        "output": (result or {}).get("output", ""),
    }

    if "filepath" in (result or {}):
        payload["filepath"] = result.get("filepath")
    if "exit_code" in (result or {}):
        payload["exit_code"] = result.get("exit_code")
    if "duration_ms" in (result or {}):
        payload["duration_ms"] = result.get("duration_ms")

    if not isinstance(payload["output"], str):
        try:
            payload["output"] = json.dumps(payload["output"])
        except Exception:
            payload["output"] = str(payload["output"])

    content = json.dumps(payload)
    raw_max = (os.getenv("DEVFORGEAI_TOOL_RESULT_MAX_CHARS", "60000") or "60000").strip()
    try:
        max_chars = int(raw_max)
    except Exception:
        max_chars = 60_000
    max_chars = max(8_000, min(max_chars, 120_000))
    if len(content) > max_chars:
        content = content[:max_chars] + "\n\n[...tool content truncated...]"
    return content


@router.post("/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    db: AsyncSession = Depends(get_db),
    memory = Depends(get_memory)
):
    """OpenAI-compatible chat completions endpoint."""

    # Resolve conversation ID early so workflow gating state can persist per chat session.
    conv_id = str(request.conversation_id) if request.conversation_id else str(uuid.uuid4())

    # 0. Check for chat commands (model management, help, etc.)
    last_user_msg = next(
        (m.content for m in reversed(request.messages) if m.role == "user"),
        None,
    )
    if last_user_msg:
        from app.services.chat_command_parser import parse_chat_command
        parsed_command = parse_chat_command(last_user_msg)
        if parsed_command:
            from app.services.chat_commands.dispatcher import dispatch_command
            command_response = await dispatch_command(
                parsed_command, db, conversation_id=conv_id,
            )
            logger.info(f"Chat command handled: {parsed_command['action']} {parsed_command['entity_type']}")
            return _system_completion(
                content=command_response,
                conversation_id=conv_id,
                actual_model="command_executor",
            )

        # No explicit command matched — check for workflow triggers
        from app.services.chat_commands.workflow_commands import (
            detect_workflow_trigger,
            handle_workflow_trigger,
            handle_suggest_pipeline,
            is_affirmative_reply,
            is_negative_reply,
            is_explicit_project_intent,
        )
        wf_state = _get_workflow_state(conv_id)

        # If we previously asked whether this should become a project, consume yes/no.
        if wf_state.get("scope_prompt_pending"):
            if is_negative_reply(last_user_msg):
                wf_state["chat_only"] = True
                wf_state["scope_prompt_pending"] = False
                wf_state["pending_trigger"] = None
                return _system_completion(
                    content=(
                        "Understood. I'll keep this conversation in regular chat mode and won't "
                        "start a project workflow unless you explicitly ask to start one."
                    ),
                    conversation_id=conv_id,
                    actual_model="workflow_detector",
                )
            if is_affirmative_reply(last_user_msg):
                pending_trigger = wf_state.get("pending_trigger")
                wf_state["chat_only"] = False
                wf_state["scope_prompt_pending"] = False
                wf_state["pending_trigger"] = None
                if pending_trigger:
                    suggestion = await handle_workflow_trigger(
                        last_user_msg, pending_trigger, db, conversation_id=conv_id,
                    )
                    return _system_completion(
                        content=suggestion,
                        conversation_id=conv_id,
                        actual_model="workflow_detector",
                        workflow_trigger=pending_trigger,
                    )

        explicit_project_intent = is_explicit_project_intent(last_user_msg)
        if not (wf_state.get("chat_only") and not explicit_project_intent):
            trigger_match = await detect_workflow_trigger(last_user_msg, db)
            if trigger_match:
                # Explicit intent -> offer workflow immediately.
                if explicit_project_intent:
                    suggestion = await handle_workflow_trigger(
                        last_user_msg, trigger_match, db, conversation_id=conv_id,
                    )
                    return _system_completion(
                        content=suggestion,
                        conversation_id=conv_id,
                        actual_model="workflow_detector",
                        workflow_trigger=trigger_match,
                    )

                # Non-explicit request -> ask if this should be project-scoped first.
                wf_state["scope_prompt_pending"] = True
                wf_state["pending_trigger"] = trigger_match
                return _system_completion(
                    content=(
                        "This could be handled as a full project workflow. "
                        "Do you want to treat this as a project?\n\n"
                        "Reply **yes** to use project workflow, or **no** to keep regular chat mode for this session."
                    ),
                    conversation_id=conv_id,
                    actual_model="workflow_detector",
                    workflow_trigger=trigger_match,
                )

            # Suggest pipeline only for explicit project intent language.
            pipeline_suggestion = await handle_suggest_pipeline(
                last_user_msg, db, conversation_id=conv_id,
            )
            if pipeline_suggestion:
                return _system_completion(
                    content=pipeline_suggestion,
                    conversation_id=conv_id,
                    actual_model="workflow_detector",
                )

    # 1. Resolve persona
    resolver = PersonaResolver(db)
    persona, primary_model, fallback_model = await resolver.resolve(request.model)
    recovery_notice: str | None = None
    
    # Apply model override if specified (user picked a specific model from dropdown)
    if request.model_override and persona:
        from app.models.model import Model as ModelORM
        from app.models.provider import Provider as ProviderORM
        from app.services.codex_oauth import should_use_codex_oauth_proxy
        from sqlalchemy import case
        _use_codex_proxy = should_use_codex_oauth_proxy("openai-codex")

        # Deterministic override resolution order:
        # 1) Model UUID (frontend dropdown now sends this)
        # 2) Provider-qualified ref: provider/model_id (e.g. openai-codex/gpt-5.3-codex)
        # 3) Plain model_id exact match only (ambiguous duplicates are rejected)
        _override_ref = request.model_override
        override_row = None
        override_issue: str | None = None

        # 1) UUID lookup
        try:
            override_uuid = uuid.UUID(_override_ref)
            override_result = await db.execute(
                select(ModelORM, ProviderORM)
                .join(ProviderORM, ModelORM.provider_id == ProviderORM.id)
                .where(ModelORM.is_active == True)
                .where(ModelORM.id == override_uuid)
                .limit(1)
            )
            override_row = override_result.first()
        except ValueError:
            pass

        # 2) provider-qualified lookup
        if not override_row and "/" in _override_ref:
            provider_hint, model_hint = _override_ref.split("/", 1)
            provider_hint = provider_hint.strip()
            model_hint = model_hint.strip()
            if provider_hint and model_hint:
                qualified_result = await db.execute(
                    select(ModelORM, ProviderORM)
                    .join(ProviderORM, ModelORM.provider_id == ProviderORM.id)
                    .where(ModelORM.is_active == True)
                    .where(func.lower(ProviderORM.name) == provider_hint.lower())
                    .where(
                        (ModelORM.model_id == model_hint)
                        | (ModelORM.model_id == _override_ref)
                    )
                    .order_by(
                        (ModelORM.model_id == model_hint).desc(),
                        (ModelORM.model_id == _override_ref).desc(),
                        case(
                            (ProviderORM.name == "openai-codex", 0 if _use_codex_proxy else -1),
                            else_=1,
                        ).desc(),
                        ModelORM.validated_at.desc().nulls_last(),
                    )
                    .limit(1)
                )
                override_row = qualified_result.first()

        # 3) plain exact model_id lookup; reject ambiguous duplicates
        if not override_row:
            exact_result = await db.execute(
                select(ModelORM, ProviderORM)
                .join(ProviderORM, ModelORM.provider_id == ProviderORM.id)
                .where(ModelORM.is_active == True)
                .where(ModelORM.model_id == _override_ref)
                .order_by(
                    case(
                        (ProviderORM.name == "openai-codex", 0 if _use_codex_proxy else -1),
                        else_=1,
                    ).desc(),
                    ModelORM.validated_at.desc().nulls_last(),
                )
            )
            exact_rows = exact_result.all()
            if len(exact_rows) == 1:
                override_row = exact_rows[0]
            elif len(exact_rows) > 1:
                providers = ", ".join(sorted({(r[1].name or "unknown") for r in exact_rows}))
                override_issue = (
                    f"Requested model '{_override_ref}' is ambiguous across providers ({providers}). "
                    "Select a specific model entry or use provider/model format."
                )

        if override_row:
            primary_model = override_row[0]
            fallback_model = None  # No fallback when explicitly overridden
            logger.info(
                "Model override resolved: requested='%s' -> matched='%s' (model_id=%s) via provider='%s'",
                _override_ref,
                primary_model.model_id,
                primary_model.id,
                override_row[1].name,
            )
        else:
            recovery_notice = (
                override_issue
                or (
                    f"Requested model '{_override_ref}' is unavailable or inactive. "
                    "I switched to a verified model for this reply and can help you reconnect the requested provider."
                )
            )
            logger.warning(
                "Model override '%s' unresolved (%s); falling back to a validated usable model",
                _override_ref,
                override_issue or "not-found",
            )
    
    if not persona:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "type": "invalid_request_error",
                    "message": f"Persona not found: {request.model}",
                    "code": "persona_not_found"
                }
            }
        )
    
    # If no model assigned, try to get a default model
    if not primary_model:
        # Get first active model as fallback
        from app.models import Model
        result = await db.execute(
            select(Model).where(Model.is_active == True).limit(1)
        )
        primary_model = result.scalar_one_or_none()
        
        if not primary_model:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": {
                        "type": "model_error",
                        "message": "No models available. Please add a model to use chat.",
                        "code": "no_models_available"
                    }
                }
            )

    # 1b. Enforce model eligibility: active + validated + provider connected.
    primary_provider = None
    fallback_provider = None
    if primary_model:
        primary_provider_result = await db.execute(select(Provider).where(Provider.id == primary_model.provider_id))
        primary_provider = primary_provider_result.scalar_one_or_none()
    if fallback_model:
        fallback_provider_result = await db.execute(select(Provider).where(Provider.id == fallback_model.provider_id))
        fallback_provider = fallback_provider_result.scalar_one_or_none()

    primary_ok, primary_reason = _evaluate_model_connectivity(primary_model, primary_provider)
    fallback_ok, fallback_reason = _evaluate_model_connectivity(fallback_model, fallback_provider)

    if not primary_ok:
        requested_name = primary_model.model_id if primary_model else "(none)"
        excluded = {str(primary_model.id)} if primary_model else set()

        # Prefer persona fallback only if it is also validated + usable.
        if fallback_ok and fallback_model:
            primary_model = fallback_model
            primary_provider = fallback_provider
            fallback_model = None
            recovery_notice = (
                f"Requested model '{requested_name}' is unavailable: {primary_reason} "
                f"Switched to fallback model '{primary_model.model_id}'."
            )
        else:
            recovery_model, recovery_provider = await _find_recovery_model(db, excluded_model_ids=excluded)
            if recovery_model and recovery_provider:
                primary_model = recovery_model
                primary_provider = recovery_provider
                fallback_model = None
                recovery_notice = (
                    f"Requested model '{requested_name}' is unavailable: {primary_reason} "
                    f"Switched to verified model '{primary_model.model_id}' for this response."
                )
            else:
                detail = {
                    "error": {
                        "type": "model_error",
                        "message": (
                            "No validated, connected chat model is currently usable. "
                            f"Primary failure: {primary_reason}. "
                            f"Fallback failure: {fallback_reason or 'no fallback configured'}."
                        ),
                        "code": "no_usable_validated_models",
                    }
                }
                raise HTTPException(status_code=503, detail=detail)

    # 1c. Guard local models against VRAM OOM risk and force cloud fallback.
    primary_vram_ok, primary_vram_reason = _evaluate_vram_fitness(primary_model, primary_provider)
    fallback_vram_ok, _fallback_vram_reason = _evaluate_vram_fitness(fallback_model, fallback_provider)

    if not primary_vram_ok:
        requested_name = primary_model.model_id if primary_model else "(none)"
        excluded = {str(primary_model.id)} if primary_model else set()

        # Prefer explicit persona fallback only when it is cloud + connected.
        if fallback_ok and fallback_vram_ok and fallback_model and fallback_provider and _is_cloud_model(fallback_model, fallback_provider):
            primary_model = fallback_model
            primary_provider = fallback_provider
            fallback_model = None
            recovery_notice = (
                f"Requested local model '{requested_name}' skipped: {primary_vram_reason} "
                f"Switched to cloud fallback '{primary_model.model_id}' to avoid local OOM."
            )
        else:
            recovery_model, recovery_provider = await _find_cloud_recovery_model(db, excluded_model_ids=excluded)
            if recovery_model and recovery_provider:
                primary_model = recovery_model
                primary_provider = recovery_provider
                fallback_model = None
                recovery_notice = (
                    f"Requested local model '{requested_name}' skipped: {primary_vram_reason} "
                    f"Switched to cloud model '{primary_model.model_id}' to avoid local OOM."
                )
            else:
                detail = {
                    "error": {
                        "type": "model_error",
                        "message": (
                            "Local model skipped due to VRAM safety guard and no usable cloud fallback is available. "
                            f"Reason: {primary_vram_reason}"
                        ),
                        "code": "no_cloud_fallback_for_vram_guard",
                    }
                }
                raise HTTPException(status_code=503, detail=detail)
    
    # 2. Handle conversation ID
    conversation_id = conv_id
    if request.conversation_id is None:
        # Auto-title from first user message
        first_user = next((m.content for m in request.messages if m.role == "user"), None)
        auto_title = None
        if first_user:
            auto_title = first_user[:60] + ("…" if len(first_user) > 60 else "")
        # Create conversation record
        conv = Conversation(
            id=uuid.UUID(conversation_id),
            persona_id=persona.id,
            title=auto_title,
            last_message_at=datetime.now(timezone.utc),
            message_count=len(request.messages),
        )
        db.add(conv)
        await db.commit()
        logger.info(f"Chat created conversation {conversation_id[:8]}… title={auto_title!r}")

    # 3. Route request
    router_service = Router(db, memory)
    
    if request.stream:
        return await _stream_response(
            router_service, persona, primary_model, fallback_model,
            request, conversation_id, db, recovery_notice
        )
    else:
        return await _sync_response(
            router_service, persona, primary_model, fallback_model,
            request, conversation_id, db, recovery_notice
        )


async def _stream_response(
    router_service, persona, primary_model, fallback_model,
    request, conversation_id, db, recovery_notice: str | None = None
):
    """Handle streaming response."""
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
    notice_prefix = f"{recovery_notice}\n\n" if recovery_notice else ""

    async def generate():
        try:
            start_time = time.time()
            full_content = ""

            if notice_prefix:
                full_content += notice_prefix
                data = json.dumps({
                    "id": completion_id,
                    "object": "chat.completion.chunk", "conversation_id": conversation_id,
                    "model": primary_model.model_id if primary_model else "unknown",
                    "choices": [{
                        "index": 0,
                        "delta": {"content": notice_prefix},
                        "finish_reason": None
                    }]
                })
                yield f"data: {data}\n\n"

            # Convert messages to dict
            msg_dicts = [{"role": m.role, "content": m.content} for m in request.messages]

            if recovery_notice:
                msg_dicts.insert(0, {
                    "role": "system",
                    "content": (
                        "The originally requested model is unavailable. Start your reply with a short notice "
                        f"using this text: '{recovery_notice}'. Then provide 3 concise actionable steps to fix "
                        "the connection/validation issue, then answer the user's actual request."
                    ),
                })

            # Inject unified identity/soul/user/method context (shared with workbench).
            # Uses async variant so active custom methods are also surfaced to the model.
            try:
                from app.services.identity_context import build_identity_context_async
                identity_block = await build_identity_context_async(db=db, include_method=True)
                if identity_block:
                    msg_dicts.insert(0, {"role": "system", "content": identity_block})
            except Exception as _e:
                logger.warning(f"Failed to inject identity context: {_e}")

            # Inject memory context into system prompt if enabled
            if persona.memory_enabled:
                try:
                    memory_context = MemoryContext(db)
                    injected_prompt = await memory_context.inject_context(
                        persona.system_prompt or "You are a helpful assistant.",
                        persona.name
                    )
                    # Prepend system message with context
                    msg_dicts.insert(0, {"role": "system", "content": injected_prompt})
                except Exception as e:
                    logger.warning(f"Failed to inject memory context: {e}")
                    # Continue without context

            # Try tool-loop path first for streaming requests so function/tool
            # calls are executed by backend instead of being emitted as raw text.
            tool_loop_used = False
            llm_timeout_fallback = False
            input_tokens = 0
            output_tokens = 0

            try:
                from app.services.tool_registry import get_tool_schemas, ALL_TOOLS
                from app.services.command_executor import execute_tool_call

                provider = await router_service._get_provider(primary_model.provider_id) if primary_model else None
                if primary_model and provider and _model_supports_tools(primary_model, provider):
                    tool_schemas = get_tool_schemas(list(ALL_TOOLS))
                    loop_messages = list(msg_dicts)
                    workspace_root = Path(__file__).resolve().parents[3]
                    max_tool_rounds = _tool_loop_max_rounds()
                    call_timeout = _adaptive_model_timeout_seconds(
                        primary_model,
                        provider,
                        base=_tool_loop_timeout_seconds(),
                    )
                    last_successful_tool_output = ""

                    for _ in range(max_tool_rounds):
                        resp_text, tool_calls, in_tok, out_tok = await asyncio.wait_for(
                            model_client.call_model_with_tools(
                                model=primary_model,
                                provider=provider,
                                messages=loop_messages,
                                tools=tool_schemas,
                                temperature=request.temperature,
                                max_tokens=request.max_tokens,
                            ),
                            timeout=call_timeout,
                        )
                        input_tokens += in_tok
                        output_tokens += out_tok

                        tool_calls = _normalize_tool_calls(resp_text, tool_calls, conv_id=conversation_id, model_id=primary_model.model_id if primary_model else "")
                        canonical_calls = _canonicalize_tool_calls(tool_calls)

                        if canonical_calls:
                            logger.info(
                                "Streaming tool-loop detected %d call(s): %s (conv=%s)",
                                len(canonical_calls),
                                [c.get("name", "") for c in canonical_calls],
                                conversation_id,
                            )
                        elif isinstance(resp_text, str) and "tool_calls" in resp_text:
                            logger.warning(
                                "Streaming parser miss: response contained tool_calls text but no canonical calls (conv=%s)",
                                conversation_id,
                            )

                        if not canonical_calls:
                            full_content = resp_text or ""
                            tool_loop_used = True
                            break

                        tool_loop_used = True
                        assistant_tool_calls = []
                        for tc in canonical_calls:
                            assistant_tool_calls.append(
                                {
                                    "id": tc.get("id", ""),
                                    "type": "function",
                                    "function": {
                                        "name": tc.get("name", ""),
                                        "arguments": json.dumps(tc.get("arguments", {})),
                                    },
                                }
                            )

                        loop_messages.append(
                            {
                                "role": "assistant",
                                "content": resp_text or None,
                                "tool_calls": assistant_tool_calls,
                            }
                        )

                        for tc in canonical_calls:
                            result = await execute_tool_call(
                                tc.get("name", ""),
                                tc.get("arguments", {}) or {},
                                workspace_root,
                            )
                            if result.get("success"):
                                tool_out = str(result.get("output", "")).strip()
                                if tool_out:
                                    last_successful_tool_output = tool_out
                            logger.info(
                                "Streaming tool executed id=%s name=%s success=%s out_len=%d conv=%s",
                                tc.get("id", ""),
                                tc.get("name", ""),
                                bool(result.get("success", False)),
                                len(str(result.get("output", ""))),
                                conversation_id,
                            )
                            loop_messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tc.get("id", ""),
                                    "name": tc.get("name", ""),
                                    "content": _tool_message_content(result),
                                }
                            )

                    if tool_loop_used and not full_content:
                        full_content = last_successful_tool_output or (
                            "I executed tool calls but reached this request's tool-loop safety limit before producing "
                            "a final response. I can continue automatically on your next message."
                        )
            except asyncio.TimeoutError:
                llm_timeout_fallback = True
                logger.warning("Streaming chat tool-loop timed out for conversation %s", conversation_id)
                full_content = (
                    "I’m still processing that and hit a response timeout. "
                    "Please try again, or break the request into smaller steps."
                )
            except Exception as tool_loop_error:
                err_str = str(tool_loop_error)
                err_type = type(tool_loop_error).__name__
                if ("ContextWindowExceededError" in err_type
                        or "context_length_exceeded" in err_str
                        or "maximum context length" in err_str.lower()
                        or "context window" in err_str.lower()):
                    _log_llm_issue(
                        "CONTEXT_OVERFLOW",
                        primary_model.model_id if primary_model else "unknown",
                        conversation_id,
                        "Request exceeded the model context window. Trim history or use a larger-context model.",
                        f"err={err_str[:200]}",
                    )
                    full_content = (
                        "Your conversation history is too long for this model's context window. "
                        "Please start a new conversation or ask me to summarize and continue."
                    )
                    llm_timeout_fallback = True
                else:
                    tool_loop_used = False
                    logger.error(
                        "Streaming tool-loop failed (raw passthrough blocked) conv=%s err=%s",
                        conversation_id,
                        tool_loop_error,
                        exc_info=True,
                    )
                # Degrade gracefully to legacy non-tool streaming path below.
                full_content = ""

            if tool_loop_used or llm_timeout_fallback:
                if full_content:
                    data = json.dumps({
                        "id": completion_id,
                        "object": "chat.completion.chunk", "conversation_id": conversation_id,
                        "model": primary_model.model_id if primary_model else "unknown",
                        "choices": [{
                            "index": 0,
                            "delta": {"content": full_content},
                            "finish_reason": None
                        }]
                    })
                    yield f"data: {data}\n\n"
            else:
                # Legacy passthrough streaming (no tool interception path hit)
                response_stream = await router_service.route_request(
                    persona, primary_model, fallback_model,
                    msg_dicts, conversation_id, stream=True,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens
                )

                async for chunk in response_stream:
                    # Parse LiteLLM chunk and format as OpenAI SSE
                    if hasattr(chunk, 'choices') and chunk.choices:
                        delta = chunk.choices[0].delta
                        content = delta.content if hasattr(delta, 'content') else None

                        if content:
                            full_content += content
                            data = json.dumps({
                                "id": completion_id,
                                "object": "chat.completion.chunk", "conversation_id": conversation_id,
                                "model": primary_model.model_id if primary_model else "unknown",
                                "choices": [{
                                    "index": 0,
                                    "delta": {"content": content},
                                    "finish_reason": None
                                }]
                            })
                            yield f"data: {data}\n\n"

            # Send done
            yield "data: [DONE]\n\n"

            # Log request with estimated tokens
            latency_ms = int((time.time() - start_time) * 1000)
            if input_tokens == 0 and output_tokens == 0:
                input_tokens = model_client.estimate_tokens(msg_dicts, primary_model) if primary_model else 0
                # Estimate output tokens from content (rough: ~4 chars per token)
                output_tokens = len(full_content) // 4 if full_content else 0
            estimated_cost = model_client.estimate_cost(input_tokens, output_tokens, primary_model) if primary_model else 0.0

            await _log_request(db, conversation_id, persona.id,
                              primary_model.id if primary_model else None,
                              primary_model.provider_id if primary_model else None,
                              input_tokens, output_tokens, latency_ms, True, None,
                              estimated_cost=estimated_cost)
            await _update_conversation_meta(db, conversation_id)
            # Persist messages to DB
            user_text = next((m['content'] for m in reversed(msg_dicts) if m['role'] == 'user'), '')
            if user_text and full_content:
                await _save_messages(db, conversation_id, user_text, full_content,
                                     model_id=primary_model.id if primary_model else None,
                                     input_tokens=input_tokens, output_tokens=output_tokens,
                                     latency_ms=latency_ms, estimated_cost=estimated_cost)

        except Exception as e:
            logger.error(f"Streaming error: {e}")
            error_data = json.dumps({
                "error": {
                    "type": "model_error",
                    "message": str(e),
                    "code": "streaming_error"
                }
            })
            yield f"data: {error_data}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


async def _sync_response(
    router_service, persona, primary_model, fallback_model,
    request, conversation_id, db, recovery_notice: str | None = None
):
    """Handle synchronous response."""
    start_time = time.time()

    try:
        # Convert messages to dict
        msg_dicts = [{"role": m.role, "content": m.content} for m in request.messages]

        if recovery_notice:
            msg_dicts.insert(0, {
                "role": "system",
                "content": (
                    "The originally requested model is unavailable. Start your reply with a short notice "
                    f"using this text: '{recovery_notice}'. Then provide 3 concise actionable steps to fix "
                    "the connection/validation issue, then answer the user's actual request."
                ),
            })

        # Validate we have messages
        if not msg_dicts:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "type": "invalid_request_error",
                        "message": "Messages cannot be empty",
                        "code": "invalid_messages"
                    }
                }
            )

        # Inject unified identity/soul/user/method context (shared with workbench).
        # Async variant also surfaces active custom methods.
        try:
            from app.services.identity_context import build_identity_context_async
            identity_block = await build_identity_context_async(db=db, include_method=True)
            if identity_block:
                msg_dicts.insert(0, {"role": "system", "content": identity_block})
        except Exception as _e:
            logger.warning(f"Failed to inject identity context: {_e}")

        # Inject memory context into system prompt if enabled
        if persona.memory_enabled:
            try:
                memory_context = MemoryContext(db)
                injected_prompt = await memory_context.inject_context(
                    persona.system_prompt or "You are a helpful assistant.",
                    persona.name
                )
                # Prepend system message with context
                msg_dicts.insert(0, {"role": "system", "content": injected_prompt})
            except Exception as e:
                logger.warning(f"Failed to inject memory context: {e}")
                # Continue without context

        # Get response from model.
        # Prefer native tool-calling loop so tool requests are executed server-side.
        # If anything fails in tool mode, fall back to the prior single-call path.
        response = None
        full_content = ""
        input_tokens = 0
        output_tokens = 0
        llm_timeout_fallback = False
        tool_loop_used = False

        # Tool-execution loop: model -> tool_calls -> execute -> feed results -> model
        try:
            from app.services.tool_registry import get_tool_schemas, ALL_TOOLS
            from app.services.command_executor import execute_tool_call

            provider = await router_service._get_provider(primary_model.provider_id) if primary_model else None
            if primary_model and provider and _model_supports_tools(primary_model, provider):
                tool_schemas = get_tool_schemas(list(ALL_TOOLS))
                loop_messages = list(msg_dicts)
                workspace_root = Path(__file__).resolve().parents[3]
                max_tool_rounds = _tool_loop_max_rounds()
                call_timeout = _adaptive_model_timeout_seconds(
                    primary_model,
                    provider,
                    base=_tool_loop_timeout_seconds(),
                )
                last_successful_tool_output = ""

                for _ in range(max_tool_rounds):
                    resp_text, tool_calls, in_tok, out_tok = await asyncio.wait_for(
                        model_client.call_model_with_tools(
                            model=primary_model,
                            provider=provider,
                            messages=loop_messages,
                            tools=tool_schemas,
                            temperature=request.temperature,
                            max_tokens=request.max_tokens,
                        ),
                        timeout=call_timeout,
                    )
                    input_tokens += in_tok
                    output_tokens += out_tok

                    tool_calls = _normalize_tool_calls(resp_text, tool_calls, conv_id=conversation_id, model_id=primary_model.model_id if primary_model else "")
                    canonical_calls = _canonicalize_tool_calls(tool_calls)

                    if canonical_calls:
                        logger.info(
                            "Sync tool-loop detected %d call(s): %s (conv=%s)",
                            len(canonical_calls),
                            [c.get("name", "") for c in canonical_calls],
                            conversation_id,
                        )
                    elif isinstance(resp_text, str) and "tool_calls" in resp_text:
                        logger.warning(
                            "Sync parser miss: response contained tool_calls text but no canonical calls (conv=%s)",
                            conversation_id,
                        )

                    if not canonical_calls:
                        full_content = resp_text or ""
                        tool_loop_used = True
                        break

                    tool_loop_used = True
                    assistant_tool_calls = []
                    for tc in canonical_calls:
                        assistant_tool_calls.append(
                            {
                                "id": tc.get("id", ""),
                                "type": "function",
                                "function": {
                                    "name": tc.get("name", ""),
                                    "arguments": json.dumps(tc.get("arguments", {})),
                                },
                            }
                        )

                    loop_messages.append(
                        {
                            "role": "assistant",
                            "content": resp_text or None,
                            "tool_calls": assistant_tool_calls,
                        }
                    )

                    for tc in canonical_calls:
                        result = await execute_tool_call(
                            tc.get("name", ""),
                            tc.get("arguments", {}) or {},
                            workspace_root,
                        )
                        if result.get("success"):
                            tool_out = str(result.get("output", "")).strip()
                            if tool_out:
                                last_successful_tool_output = tool_out
                        logger.info(
                            "Sync tool executed id=%s name=%s success=%s out_len=%d conv=%s",
                            tc.get("id", ""),
                            tc.get("name", ""),
                            bool(result.get("success", False)),
                            len(str(result.get("output", ""))),
                            conversation_id,
                        )
                        loop_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.get("id", ""),
                                "name": tc.get("name", ""),
                                "content": _tool_message_content(result),
                            }
                        )

                if tool_loop_used and not full_content:
                    full_content = last_successful_tool_output or (
                        "I executed tool calls but reached this request's tool-loop safety limit before producing "
                        "a final response. I can continue automatically on your next message."
                    )
        except asyncio.TimeoutError:
            llm_timeout_fallback = True
            logger.warning("Sync chat tool-loop timed out for conversation %s", conversation_id)
            full_content = (
                "I’m still processing that and hit a response timeout. "
                "Please try again, or break the request into smaller steps."
            )
        except Exception as tool_loop_error:
            err_str = str(tool_loop_error)
            err_type = type(tool_loop_error).__name__
            if ("ContextWindowExceededError" in err_type
                    or "context_length_exceeded" in err_str
                    or "maximum context length" in err_str.lower()
                    or "context window" in err_str.lower()):
                _log_llm_issue(
                    "CONTEXT_OVERFLOW",
                    primary_model.model_id if primary_model else "unknown",
                    conversation_id,
                    "Request exceeded the model context window. Trim history or use a larger-context model.",
                    f"err={err_str[:200]}",
                )
                full_content = (
                    "Your conversation history is too long for this model's context window. "
                    "Please start a new conversation or ask me to summarize and continue."
                )
                llm_timeout_fallback = True
            else:
                tool_loop_used = False
                logger.error(
                    "Sync tool-loop failed (raw passthrough blocked) conv=%s err=%s",
                    conversation_id,
                    tool_loop_error,
                    exc_info=True,
                )
            # Degrade gracefully to legacy non-tool single-call path below.
            full_content = ""

        # Fallback: previous single-call behavior
        if not tool_loop_used and not llm_timeout_fallback:
            try:
                provider = await router_service._get_provider(primary_model.provider_id) if primary_model else None
                single_call_timeout = _adaptive_model_timeout_seconds(
                    primary_model,
                    provider,
                    base=_chat_completion_timeout_seconds(),
                )
                response = await asyncio.wait_for(
                    router_service.route_request(
                        persona, primary_model, fallback_model,
                        msg_dicts, conversation_id, stream=False,
                        temperature=request.temperature,
                        max_tokens=request.max_tokens
                    ),
                    timeout=single_call_timeout,
                )
            except asyncio.TimeoutError:
                llm_timeout_fallback = True
                logger.warning("Sync chat completion timed out for conversation %s", conversation_id)
                full_content = (
                    "I’m still processing that and hit a response timeout. "
                    "Please try again, or break the request into smaller steps."
                )

        # Extract content and usage from LiteLLM response when available.
        if not llm_timeout_fallback and response is not None:
            if hasattr(response, 'choices') and response.choices and len(response.choices) > 0:
                choice = response.choices[0]
                if hasattr(choice, 'message') and choice.message:
                    full_content = choice.message.content or ""
                else:
                    logger.warning(f"Unexpected response format: {response}")
                    full_content = str(response)
            else:
                logger.warning(f"No choices in response: {response}")
                # Try to extract content from raw response
                if hasattr(response, 'content'):
                    full_content = response.content or ""
                elif isinstance(response, str):
                    full_content = response
                else:
                    full_content = "No response generated"

            # Extract actual token usage if available
            if hasattr(response, 'usage') and response.usage:
                input_tokens = response.usage.prompt_tokens or 0
                output_tokens = response.usage.completion_tokens or 0

            # Last-chance interception: if fallback single-call returned tool JSON
            # as plain text, execute it and re-query before returning to frontend.
            recovered_calls = _extract_text_tool_calls(full_content)
            canonical_calls = _canonicalize_tool_calls(recovered_calls)
            if canonical_calls and primary_model:
                try:
                    from app.services.tool_registry import get_tool_schemas, ALL_TOOLS
                    from app.services.command_executor import execute_tool_call

                    provider = await router_service._get_provider(primary_model.provider_id)
                    if provider:
                        loop_messages = list(msg_dicts)
                        workspace_root = Path(__file__).resolve().parents[3]
                        recovery_timeout = _adaptive_model_timeout_seconds(
                            primary_model,
                            provider,
                            base=_chat_completion_timeout_seconds(),
                        )

                        assistant_tool_calls = []
                        for tc in canonical_calls:
                            assistant_tool_calls.append(
                                {
                                    "id": tc.get("id", ""),
                                    "type": "function",
                                    "function": {
                                        "name": tc.get("name", ""),
                                        "arguments": json.dumps(tc.get("arguments", {})),
                                    },
                                }
                            )

                        loop_messages.append(
                            {
                                "role": "assistant",
                                "content": full_content or None,
                                "tool_calls": assistant_tool_calls,
                            }
                        )

                        for tc in canonical_calls:
                            result = await execute_tool_call(
                                tc.get("name", ""),
                                tc.get("arguments", {}) or {},
                                workspace_root,
                            )
                            logger.info(
                                "Fallback tool executed id=%s name=%s success=%s out_len=%d conv=%s",
                                tc.get("id", ""),
                                tc.get("name", ""),
                                bool(result.get("success", False)),
                                len(str(result.get("output", ""))),
                                conversation_id,
                            )
                            loop_messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tc.get("id", ""),
                                    "name": tc.get("name", ""),
                                    "content": _tool_message_content(result),
                                }
                            )

                        final_text, _final_calls, in2, out2 = await asyncio.wait_for(
                            model_client.call_model_with_tools(
                                model=primary_model,
                                provider=provider,
                                messages=loop_messages,
                                tools=get_tool_schemas(list(ALL_TOOLS)),
                                temperature=request.temperature,
                                max_tokens=request.max_tokens,
                            ),
                            timeout=recovery_timeout,
                        )
                        if final_text:
                            logger.info("Recovered text-mode tool_calls in fallback path for conversation %s", conversation_id)
                            full_content = final_text
                            input_tokens += in2
                            output_tokens += out2
                except Exception as e:
                    logger.warning("Fallback text-mode tool interception failed: %s", e)

        # Fallback token estimation (also used by timeout fallback path)
        if input_tokens == 0 and output_tokens == 0:
            input_tokens = model_client.estimate_tokens(msg_dicts, primary_model) if primary_model else 0
            output_tokens = len(full_content) // 4 if full_content else 0

        # Calculate cost
        estimated_cost = model_client.estimate_cost(input_tokens, output_tokens, primary_model) if primary_model else 0.0

        latency_ms = int((time.time() - start_time) * 1000)

        # Log request with actual tokens
        await _log_request(db, conversation_id, persona.id,
                          primary_model.id if primary_model else None,
                          primary_model.provider_id if primary_model else None,
                          input_tokens, output_tokens, latency_ms, True, None,
                          estimated_cost=estimated_cost)
        await _update_conversation_meta(db, conversation_id)
        # Persist messages to DB
        user_text = next((m['content'] for m in reversed(msg_dicts) if m['role'] == 'user'), '')
        if user_text and full_content:
            await _save_messages(db, conversation_id, user_text, full_content,
                                 model_id=primary_model.id if primary_model else None,
                                 input_tokens=input_tokens, output_tokens=output_tokens,
                                 latency_ms=latency_ms, estimated_cost=estimated_cost)

        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "conversation_id": conversation_id,
            "model": primary_model.model_id if primary_model else "unknown",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": (
                        f"{recovery_notice}\n\n{full_content}"
                        if recovery_notice and not (full_content or "").startswith(recovery_notice)
                        else full_content
                    )
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": input_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens
            },
            "modelmesh": {
                "persona_used": persona.name,
                "actual_model": primary_model.model_id if primary_model else "unknown",
                "estimated_cost": round(estimated_cost, 6),
                "provider": "ollama"  # Simplified - avoid lazy loading
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sync response error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "type": "model_error",
                    "message": str(e),
                    "code": "model_error"
                }
            }
        )


async def _save_messages(db, conversation_id: str, user_content: str, assistant_content: str,
                         model_id=None, input_tokens=0, output_tokens=0, latency_ms=0, estimated_cost=0.0):
    """Persist user + assistant messages to the database and write a context snapshot."""
    from app.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as fresh_db:
            conv_str = str(conversation_id)
            model_str = str(model_id) if model_id else None
            user_msg = Message(
                conversation_id=conv_str,
                role="user",
                content=user_content,
            )
            fresh_db.add(user_msg)
            asst_msg = Message(
                conversation_id=conv_str,
                role="assistant",
                content=assistant_content,
                model_used=model_str,
                tokens_in=input_tokens,
                tokens_out=output_tokens,
                latency_ms=latency_ms,
                estimated_cost=estimated_cost,
            )
            fresh_db.add(asst_msg)
            await fresh_db.commit()
            logger.info(f"Saved messages for conv {conversation_id[:8]}")

            # Check for @mentions and create notifications
            try:
                from app.services.mentions import extract_mentions
                from app.routes.collaboration import get_user_by_username
                from app.models.notification import Notification
                from app.services.ws_manager import manager

                mentioned_usernames = extract_mentions(user_content)
                for username in mentioned_usernames:
                    target_user = get_user_by_username(username)
                    if not target_user:
                        continue
                    target_id = target_user.get("id", "")
                    preview = user_content[:120] + ("…" if len(user_content) > 120 else "")
                    notif = Notification(
                        user_id=target_id,
                        type="mention",
                        title=f"You were mentioned in a conversation",
                        message=preview,
                        conversation_id=conv_str,
                        message_id=str(user_msg.id),
                    )
                    fresh_db.add(notif)
                    # Push real-time notification via WebSocket
                    try:
                        import asyncio as _ws_asyncio
                        _ws_asyncio.create_task(manager.send_to_user(target_id, {
                            "type": "notification",
                            "payload": notif.to_dict(),
                        }))
                    except Exception:
                        pass  # WebSocket push is best-effort
                if mentioned_usernames:
                    await fresh_db.commit()
                    logger.info(f"Created {len(mentioned_usernames)} mention notification(s) in conv {conversation_id[:8]}")
            except Exception as mention_err:
                logger.warning(f"Mention processing failed (non-fatal): {mention_err}")

            # Write context snapshot — load all messages for this conversation
            try:
                from sqlalchemy import select as _select
                from app.models import Message as _Msg, Conversation as _Conv
                from app.services.context_snapshot import write_snapshot, maybe_distill_memory

                # Fetch conversation title + all messages
                conv = await fresh_db.get(_Conv, uuid.UUID(conv_str))
                title = conv.title if conv else ""

                all_msgs_result = await fresh_db.execute(
                    _select(_Msg)
                    .where(_Msg.conversation_id == conv_str)
                    .order_by(_Msg.created_at)
                )
                all_msgs = all_msgs_result.scalars().all()
                msg_dicts = [{"role": m.role, "content": m.content} for m in all_msgs]

                # Resolve model name
                model_name = None
                if model_id:
                    from app.models import Model as _Model
                    m_obj = await fresh_db.get(_Model, model_id)
                    model_name = m_obj.model_id if m_obj else str(model_id)

                write_snapshot(
                    conversation_id=conv_str,
                    title=title or "",
                    messages=msg_dicts,
                    model_name=model_name or "",
                )

                # Periodically distill memory from the conversation
                import asyncio as _asyncio
                _asyncio.create_task(maybe_distill_memory(
                    conversation_id=conv_str,
                    messages=msg_dicts,
                    model_name=model_name or "",
                    message_count=len(all_msgs),
                ))

                # Periodically detect preferences (every 10 messages)
                if len(all_msgs) > 0 and len(all_msgs) % 10 == 0:
                    _asyncio.create_task(_maybe_detect_preferences(msg_dicts[-20:]))

            except Exception as snap_err:
                logger.warning(f"Snapshot write failed (non-fatal): {snap_err}")

    except Exception as e:
        logger.error(f"Failed to save messages for conv {conversation_id}: {e}", exc_info=True)


async def _maybe_detect_preferences(messages: list[dict]):
    """Background task: use LLM to detect preferences from recent messages."""
    try:
        import json
        from app.database import AsyncSessionLocal
        from app.models.preference import Preference
        from app.services.model_client import ModelClient
        from app.models.model import Model as ModelORM
        from app.models.provider import Provider as ProviderORM
        from sqlalchemy import select as _sel

        async with AsyncSessionLocal() as db:
            # Use first active local model (cheap/fast)
            result = await db.execute(
                _sel(ModelORM, ProviderORM)
                .join(ProviderORM, ModelORM.provider_id == ProviderORM.id)
                .where(ProviderORM.name.ilike("%ollama%"))
                .where(ModelORM.is_active == True)
                .limit(1)
            )
            row = result.first()
            if not row:
                # Fallback to any active model
                result = await db.execute(
                    _sel(ModelORM, ProviderORM)
                    .join(ProviderORM, ModelORM.provider_id == ProviderORM.id)
                    .where(ModelORM.is_active == True)
                    .limit(1)
                )
                row = result.first()
            if not row:
                return

            model_orm, provider_orm = row
            conv_text = "\n".join(f"{m.get('role','user').upper()}: {m.get('content','')}" for m in messages)

            detect_prompt = (
                "Analyze this conversation and extract user preferences the AI should remember. "
                "Return ONLY a JSON array of objects with keys: key (snake_case), value (one sentence), "
                "category (general|coding|communication|ui|workflow). "
                "If none found, return []. Do NOT invent preferences."
            )

            client = ModelClient()
            response = await client.call_model(
                model=model_orm, provider=provider_orm,
                messages=[
                    {"role": "system", "content": detect_prompt + "\n\n" + conv_text},
                    {"role": "user", "content": "Extract preferences. JSON array only."},
                ],
                stream=False, temperature=0.1, max_tokens=500,
            )

            raw = response.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            detected = json.loads(raw)
            if not isinstance(detected, list):
                return

            # Check existing keys
            existing = await db.execute(_sel(Preference.key))
            existing_keys = {r[0] for r in existing.fetchall()}

            saved = 0
            for item in detected:
                key = item.get("key", "").strip()
                value = item.get("value", "").strip()
                if not key or not value or key in existing_keys:
                    continue
                pref = Preference(
                    id=str(uuid.uuid4()),
                    key=key, value=value,
                    category=item.get("category", "general").strip(),
                    source="detected",
                )
                db.add(pref)
                existing_keys.add(key)
                saved += 1

            if saved:
                await db.commit()
                logger.info(f"Auto-detected {saved} new preference(s) from chat")

    except Exception as e:
        logger.debug(f"Preference detection skipped: {e}")


async def _update_conversation_meta(db, conversation_id: str, added_messages: int = 2):
    """Update last_message_at and message_count after each exchange."""
    from app.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as fresh_db:
            conv = await fresh_db.get(Conversation, uuid.UUID(str(conversation_id)))
            if conv:
                conv.last_message_at = datetime.now(timezone.utc)
                conv.message_count = (conv.message_count or 0) + added_messages
                await fresh_db.commit()
    except Exception as e:
        logger.warning(f"Failed to update conversation meta: {e}")


async def _log_request(db, conversation_id, persona_id, model_id, provider_id,
                       input_tokens, output_tokens, latency_ms, success, error_message,
                       estimated_cost=0.0):
    """Log request to database with actual token counts and cost."""
    from app.models import RequestLog

    try:
        log = RequestLog(
            conversation_id=conversation_id,
            persona_id=persona_id,
            model_id=model_id,
            provider_id=provider_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            estimated_cost=estimated_cost,
            success=success,
            error_message=error_message
        )
        db.add(log)
        await db.commit()
    except Exception as e:
        # Don't fail the request if logging fails
        import logging
        logging.getLogger(__name__).warning(f"Failed to log request: {e}")
