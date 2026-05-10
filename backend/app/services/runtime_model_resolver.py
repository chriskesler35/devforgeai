"""Unified runtime model resolver.

This service centralizes model reference resolution, provider readiness checks,
and Copilot runtime alias normalization so chat and agentic paths can share one
contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal, Optional, Union
from uuid import UUID
import logging
import os
import json
import re
import socket
import uuid
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, Model, ModelSelectionLog, ModelVerification, Provider, SessionModelPin
from app.services.github_copilot import get_copilot_auth_token, resolve_supported_copilot_model
from app.services.provider_credentials import has_provider_api_key

ResolveIntent = Literal["chat", "agentic", "pipeline", "tools"]

_LOCAL_MODEL_PROVIDERS = {
    "ollama",
    "comfyui-local",
    "local",
    "lm-studio",
    "lmstudio",
    "llamacpp",
}

_FEATURE_ALIASES: dict[str, str] = {
    "functions": "function_calling",
    "function": "function_calling",
    "function_calling": "function_calling",
    "chat": "chat",
    "streaming": "streaming",
    "vision": "vision",
    "embeddings": "embeddings",
}

logger = logging.getLogger(__name__)


@dataclass
class Ready:
    model: Model
    provider: Provider
    runtime_model_id: str
    resolved_from: str
    notes: list[str] = field(default_factory=list)


@dataclass
class NeedsLiveProbe:
    model: Model
    provider: Provider
    reason_code: str
    probe_action: str
    resolved_from: str
    notes: list[str] = field(default_factory=list)


@dataclass
class Unreachable:
    reason_code: str
    user_message: str
    technical_detail: str
    candidates_tried: list[str] = field(default_factory=list)
    remediation: list[str] = field(default_factory=list)


ResolveResult = Union[Ready, NeedsLiveProbe, Unreachable]


def _normalize_model_ref_for_lookup(model_ref: str) -> str:
    """Normalize common alias/versioned refs to stable catalog IDs for lookup."""
    ref = (model_ref or "").strip()
    low = ref.lower()
    alias_map = {
        "gpt-5-codex": "gpt-5",
        "gpt-5.3": "gpt-5",
        "gpt-5.4": "gpt-5",
        "gpt-5.3-codex": "gpt-5",
        "gpt-5.4-codex": "gpt-5",
    }
    if low in alias_map:
        return alias_map[low]
    if re.fullmatch(r"gpt-5\.\d+(?:-codex)?", low):
        return "gpt-5"
    return ref


def _enabled_capabilities(capabilities: object) -> set[str]:
    if not isinstance(capabilities, dict):
        return set()
    runtime_relevant = {"chat", "code", "streaming"}
    return {
        str(key)
        for key, enabled in capabilities.items()
        if enabled and str(key) in runtime_relevant
    }


def _runtime_fallback_capabilities(model_obj: object) -> set[str]:
    requested_caps = _enabled_capabilities(getattr(model_obj, "capabilities", None))
    if requested_caps:
        return requested_caps
    return {"chat", "streaming"}


def _error_to_text(error: str | Exception) -> str:
    return str(error or "")


def should_deactivate_model_from_runtime_error(error: str | Exception) -> bool:
    low = _error_to_text(error).lower()
    return any(marker in low for marker in (
        "notfounderror",
        "model_not_found",
        "does not exist",
        "404",
    ))


def should_failover_on_runtime_error(error: str | Exception) -> bool:
    low = _error_to_text(error).lower()
    markers = (
        "notfounderror",
        "model_not_found",
        "does not exist",
        "authenticationerror",
        "invalid_api_key",
        "insufficient_quota",
        "exceeded your current quota",
        "ratelimiterror",
        "apiconnectionerror",
        "service unavailable",
        "temporarily unavailable",
        "timeout",
        "timed out",
        "connection refused",
        "connection reset",
        "bad gateway",
        "gateway timeout",
        "overloaded",
        "503",
        "502",
        "429",
        "401",
        "404",
    )
    return any(marker in low for marker in markers)


def humanize_runtime_model_error(error: str | Exception, model_id: str) -> str:
    err_str = _error_to_text(error)
    friendly = err_str
    low = err_str.lower()
    if "insufficient_quota" in low or "exceeded your current quota" in low:
        friendly = (
            "OpenAI quota exceeded - your account is out of credits. "
            "Top up at https://platform.openai.com/account/billing, or pick a different provider."
        )
    elif "authenticationerror" in low or "x-api-key" in low or "401" in err_str or "invalid_api_key" in low:
        friendly = f"Provider rejected the API key for model '{model_id}'. Check the key in your .env file."
    elif "ratelimiterror" in low or "429" in err_str:
        friendly = f"Rate-limited by provider for model '{model_id}'. Wait and retry, or switch models."
    elif "notfounderror" in low or "model_not_found" in low or "does not exist" in low or ("404" in err_str and "openai" in low):
        friendly = (
            f"Model '{model_id}' doesn't exist on the provider's API. "
            "It may have been renamed or removed. Pick a different model."
        )
    elif "timeout" in low or "timed out" in low:
        friendly = f"Provider call for model '{model_id}' timed out."
    elif "apiconnectionerror" in low or "connection refused" in low or "connection reset" in low:
        friendly = f"Could not connect to the provider for model '{model_id}'."
    elif "service unavailable" in low or "temporarily unavailable" in low or "503" in low or "502" in low:
        friendly = f"Provider for model '{model_id}' is temporarily unavailable."
    return friendly


def _is_cloud_runtime_model(model: Model | None, provider: Provider | None) -> bool:
    if not model:
        return False
    model_id = (model.model_id or "").strip().lower()
    if model_id.endswith(":cloud"):
        return True
    provider_name = (provider.name or "").strip().lower() if provider else ""
    return provider_name not in _LOCAL_MODEL_PROVIDERS


async def find_validated_runtime_recovery_model(
    db: AsyncSession,
    *,
    intent: ResolveIntent,
    excluded_model_ids: set[str] | None = None,
    cloud_only: bool = False,
    provider_name: str | None = None,
) -> tuple[Model | None, Provider | None]:
    excluded = excluded_model_ids or set()
    query = (
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.is_active == True)
        .where(Model.validation_status == "validated")
        .order_by(Model.validated_at.desc().nulls_last(), Model.created_at.desc())
    )
    if provider_name:
        query = query.where(func.lower(Provider.name) == provider_name.lower())

    result = await db.execute(query)
    rows = result.all()
    for model, provider in rows:
        if str(model.id) in excluded:
            continue
        if cloud_only and not _is_cloud_runtime_model(model, provider):
            continue
        ref = f"{provider.name}/{model.model_id}" if provider and provider.name else str(model.id)
        resolved = await resolve_model_for_runtime(db, ref, intent=intent)
        if isinstance(resolved, Ready):
            return resolved.model, resolved.provider
    return None, None


async def resolve_runtime_model_row_for_lookup(
    db: AsyncSession,
    model_ref: str,
    *,
    intent: ResolveIntent,
    include_fuzzy: bool = True,
) -> tuple[Model | None, Provider | None]:
    normalized_ref = _normalize_model_ref_for_lookup(model_ref)
    resolved = await resolve_model_for_runtime(db, normalized_ref, intent=intent)
    if isinstance(resolved, (Ready, NeedsLiveProbe)):
        return resolved.model, resolved.provider
    if not include_fuzzy or not normalized_ref:
        return None, None

    last_part = str(normalized_ref).split("/")[-1]
    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.model_id.contains(last_part))
        .where(Model.is_active == True)
        .order_by(Model.validated_at.desc().nulls_last(), Model.display_name)
    )
    for model_obj, provider_obj in result.all():
        ref = f"{provider_obj.name}/{model_obj.model_id}" if provider_obj and provider_obj.name else str(model_obj.id)
        candidate = await resolve_model_for_runtime(db, ref, intent=intent)
        if isinstance(candidate, (Ready, NeedsLiveProbe)):
            return candidate.model, candidate.provider
    return None, None


async def collect_runtime_fallback_candidates(
    db: AsyncSession,
    model_ref: str,
    *,
    intent: ResolveIntent,
    feature_required: str | None = None,
    explicit_fallback_refs: list[str] | None = None,
    allow_catalog_fallbacks: bool = True,
    limit: int = 3,
) -> list[tuple[Model, Provider, str]]:
    candidates: list[tuple[Model, Provider, str]] = []
    seen: set[str] = set()

    requested_model, requested_provider = await resolve_runtime_model_row_for_lookup(
        db,
        model_ref,
        intent=intent,
        include_fuzzy=True,
    )
    required_caps = _runtime_fallback_capabilities(requested_model)
    requested_context = getattr(requested_model, "context_window", None)

    if requested_model:
        seen.add(str(requested_model.id))

    normalized_feature = _normalize_feature_name(feature_required) if feature_required else None

    configured_fallback_refs = await _load_user_configured_fallback_refs(db, normalized_feature)

    for fallback_ref in explicit_fallback_refs or []:
        model_obj, provider_obj = await resolve_runtime_model_row_for_lookup(
            db,
            fallback_ref,
            intent=intent,
            include_fuzzy=False,
        )
        if not model_obj or not provider_obj:
            continue
        if str(model_obj.id) in seen:
            continue
        if normalized_feature:
            verification = await get_model_verification(db, model_obj.id)
            if not verification or verification.verification_status != "verified":
                continue
            if not (verification.capabilities or {}).get(normalized_feature, False):
                continue
        seen.add(str(model_obj.id))
        candidates.append((model_obj, provider_obj, "configured fallback"))
        if len(candidates) >= limit:
            return candidates

    for fallback_ref in configured_fallback_refs:
        model_obj, provider_obj = await resolve_runtime_model_row_for_lookup(
            db,
            fallback_ref,
            intent=intent,
            include_fuzzy=False,
        )
        if not model_obj or not provider_obj:
            continue
        if str(model_obj.id) in seen:
            continue
        if normalized_feature:
            verification = await get_model_verification(db, model_obj.id)
            if not verification or verification.verification_status != "verified":
                continue
            if not (verification.capabilities or {}).get(normalized_feature, False):
                continue
        seen.add(str(model_obj.id))
        candidates.append((model_obj, provider_obj, "user configured fallback"))
        if len(candidates) >= limit:
            return candidates

    if not allow_catalog_fallbacks:
        return candidates

    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.is_active == True)
        .where(Model.validation_status == "validated")
        .order_by(Model.validated_at.desc().nulls_last(), Model.created_at.desc())
    )

    scored: list[tuple[tuple[int, int, int, float, str], Model, Provider]] = []
    for model_obj, provider_obj in result.all():
        if str(model_obj.id) in seen:
            continue

        if normalized_feature:
            verification = await get_model_verification(db, model_obj.id)
            if not verification or verification.verification_status != "verified":
                continue
            if not (verification.capabilities or {}).get(normalized_feature, False):
                continue

        candidate_caps = _enabled_capabilities(getattr(model_obj, "capabilities", None))
        if required_caps and not required_caps.issubset(candidate_caps):
            continue

        ref = f"{provider_obj.name}/{model_obj.model_id}" if provider_obj and provider_obj.name else str(model_obj.id)
        candidate = await resolve_model_for_runtime(db, ref, intent=intent)
        if not isinstance(candidate, Ready):
            continue

        same_provider = 0 if requested_provider and model_obj.provider_id == requested_provider.id else 1
        context_gap = 0 if (not requested_context or not getattr(model_obj, "context_window", None) or model_obj.context_window >= requested_context) else 1
        validated_rank = 0 if getattr(model_obj, "validated_at", None) else 1
        validated_ts = -(model_obj.validated_at.timestamp() if model_obj.validated_at else 0)
        scored.append(
            (
                (same_provider, context_gap, validated_rank, validated_ts, (model_obj.display_name or model_obj.model_id or "").lower()),
                candidate.model,
                candidate.provider,
            )
        )

    for _, model_obj, provider_obj in sorted(scored):
        seen.add(str(model_obj.id))
        reason = "same-provider validated backup" if requested_provider and model_obj.provider_id == requested_provider.id else "validated backup"
        candidates.append((model_obj, provider_obj, reason))
        if len(candidates) >= limit:
            break

    return candidates


async def build_runtime_model_chain_for_runtime(
    db: AsyncSession,
    model_ref: str,
    *,
    intent: ResolveIntent,
    session_id: str | None = None,
    explicit_fallback_refs: list[str] | None = None,
    limit: int = 3,
) -> tuple[list[tuple[Model, Provider, str]], str | None]:
    chain: list[tuple[Model, Provider, str]] = []
    seen: set[str] = set()

    feature_required = _feature_for_intent(intent)
    primary = await resolve_with_verification(
        db,
        model_ref,
        feature_required=feature_required,
        intent=intent,
        session_id=session_id,
    )
    primary_model = None
    if isinstance(primary, (Ready, NeedsLiveProbe)):
        primary_model = primary.model
        primary_provider = primary.provider
        chain.append((primary_model, primary_provider, "selected model"))
        seen.add(str(primary_model.id))

    for model_obj, provider_obj, reason in await collect_runtime_fallback_candidates(
        db,
        model_ref,
        intent=intent,
        feature_required=feature_required,
        explicit_fallback_refs=explicit_fallback_refs,
        allow_catalog_fallbacks=bool(primary_model),
        limit=limit,
    ):
        if str(model_obj.id) in seen:
            continue
        chain.append((model_obj, provider_obj, reason))
        seen.add(str(model_obj.id))

    preflight_note = None
    if not primary_model and chain:
        preflight_note = (
            f"Selected model '{model_ref}' was unavailable, inactive, unvalidated, or missing credentials. "
            f"Switching to validated backup '{chain[0][0].model_id}'."
        )

    return chain, preflight_note


def is_authoritative_model_not_supported_error(error_text: str) -> bool:
    low = (error_text or "").lower()
    markers = (
        "model_not_supported",
        "requested model is not supported",
        "model_not_found",
        "notfounderror",
        "does not exist",
    )
    return any(marker in low for marker in markers)


async def mark_runtime_validation_success(
    db: AsyncSession,
    model: Model | None,
    *,
    intent: ResolveIntent,
) -> bool:
    """Promote an unverified model to validated after successful runtime use.

    Returns True when a row was changed.
    """
    if not model:
        return False
    if (model.validation_status or "unverified").strip().lower() == "validated":
        return False

    row = (await db.execute(select(Model).where(Model.id == model.id))).scalar_one_or_none()
    if not row:
        return False

    row.validation_status = "validated"
    row.validation_source = f"runtime_success:{intent}"
    row.validation_warning = None
    row.validation_error = None
    row.validated_at = datetime.now(timezone.utc)
    await db.commit()
    return True


async def mark_runtime_validation_failure(
    db: AsyncSession,
    model: Model | None,
    *,
    intent: ResolveIntent,
    error_text: str,
    deactivate: bool = False,
) -> bool:
    """Demote model validation only for authoritative not-supported errors.

    Returns True when a row was changed.
    """
    if not model or not is_authoritative_model_not_supported_error(error_text):
        return False

    row = (await db.execute(select(Model).where(Model.id == model.id))).scalar_one_or_none()
    if not row:
        return False

    row.validation_status = "failed"
    row.validation_source = f"runtime_rejection:{intent}"
    row.validation_error = "model_not_supported"
    row.validation_warning = "Provider rejected this model during live runtime call."
    if deactivate:
        row.is_active = False
    await db.commit()
    return True


def _strict_validation_required() -> bool:
    raw = (os.environ.get("DEVFORGEAI_AGENTIC_REQUIRE_VALIDATION") or "").strip().lower()
    return raw in {"1", "true", "yes"}


def _can_connect_to_base_url(base_url: str | None, timeout: float = 0.35) -> bool:
    if not base_url:
        return False
    # Allow override via env var, fallback to 1.5s (was 0.35s)
    try:
        import os
        probe_timeout = float(os.environ.get("MODEL_LOCAL_PROBE_TIMEOUT", "1.5"))
    except Exception:
        probe_timeout = 1.5
    try:
        parsed = urlparse(base_url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not host:
            return False
        with socket.create_connection((host, port), timeout=probe_timeout):
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


async def _lookup_by_uuid(db: AsyncSession, ref: str) -> tuple[Optional[tuple[Model, Provider]], str]:
    try:
        model_uuid = uuid.UUID(str(ref))
    except ValueError:
        return None, ""

    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.id == model_uuid)
        .limit(1)
    )
    row = result.first()
    return row, "uuid"


async def _lookup_by_provider_qualified_ref(
    db: AsyncSession,
    ref: str,
) -> tuple[Optional[tuple[Model, Provider]], str]:
    if "/" not in ref:
        return None, ""
    provider_name, model_id = ref.split("/", 1)
    provider_name = provider_name.strip().lower()
    model_id = model_id.strip()
    if not provider_name or not model_id:
        return None, ""

    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(func.lower(Provider.name) == provider_name)
        .where(func.lower(Model.model_id) == model_id.lower())
        .limit(1)
    )
    row = result.first()
    return row, "provider_model"


async def _lookup_by_plain_model_id(
    db: AsyncSession,
    ref: str,
) -> tuple[Optional[tuple[Model, Provider]], str, Optional[Unreachable]]:
    normalized = (ref or "").strip()
    if not normalized:
        return None, "", None

    result = await db.execute(
        select(Model, Provider)
        .join(Provider, Model.provider_id == Provider.id)
        .where(Model.model_id == normalized)
    )
    rows = result.all()
    if not rows:
        return None, "", None

    # Prefer validated+usable models, then active, then any
    def is_usable(model, provider):
        return (
            model.is_active and
            (provider.is_active if provider else True) and
            (model.validation_status or "unverified").strip().lower() == "validated"
            and _provider_is_usable(provider)
        )

    usable = [(m, p) for m, p in rows if is_usable(m, p)]
    if len(usable) == 1:
        return (usable[0][0], usable[0][1]), "plain_model", None
    if len(usable) > 1:
        # Still ambiguous, but only among validated+usable
        providers = sorted({(p.name or "unknown") for _, p in usable})
        return None, "", Unreachable(
            reason_code="ambiguous_model_ref",
            user_message=(
                f"Requested model '{normalized}' exists under multiple validated+usable providers ({', '.join(providers)}). "
                "Use provider/model format or model UUID."
            ),
            technical_detail=f"ambiguous plain model_id: {normalized}",
            candidates_tried=[normalized],
            remediation=["Use provider/model_id", "Use model UUID from model list"],
        )

    # Fallback: prefer active
    active = [(m, p) for m, p in rows if m.is_active and (p.is_active if p else True)]
    if len(active) == 1:
        return (active[0][0], active[0][1]), "plain_model", None
    if len(active) > 1:
        providers = sorted({(p.name or "unknown") for _, p in active})
        return None, "", Unreachable(
            reason_code="ambiguous_model_ref",
            user_message=(
                f"Requested model '{normalized}' exists under multiple active providers ({', '.join(providers)}). "
                "Use provider/model format or model UUID."
            ),
            technical_detail=f"ambiguous plain model_id: {normalized}",
            candidates_tried=[normalized],
            remediation=["Use provider/model_id", "Use model UUID from model list"],
        )

    # If only one, return it
    if len(rows) == 1:
        return rows[0], "plain_model", None

    providers = sorted({(row[1].name or "unknown") for row in rows})
    return None, "", Unreachable(
        reason_code="ambiguous_model_ref",
        user_message=(
            f"Requested model '{normalized}' exists under multiple providers ({', '.join(providers)}). "
            "Use provider/model format or model UUID."
        ),
        technical_detail=f"ambiguous plain model_id: {normalized}",
        candidates_tried=[normalized],
        remediation=["Use provider/model_id", "Use model UUID from model list"],
    )


async def _resolve_ref(db: AsyncSession, ref: str) -> tuple[Optional[tuple[Model, Provider]], str, Optional[Unreachable]]:
    row, resolved_from = await _lookup_by_uuid(db, ref)
    if row:
        return row, resolved_from, None

    row, resolved_from = await _lookup_by_provider_qualified_ref(db, ref)
    if row:
        return row, resolved_from, None

    row, resolved_from, unresolved = await _lookup_by_plain_model_id(db, ref)
    if unresolved:
        return None, "", unresolved
    return row, resolved_from, None


async def resolve_model_for_runtime(
    db: AsyncSession,
    ref: str,
    *,
    intent: ResolveIntent,
    use_codex_proxy: bool | None = None,
    prefer_cloud_fallback: bool = False,
    explicit_fallback_refs: list[str] | None = None,
) -> ResolveResult:
    """Resolve a runtime model reference to a Ready/NeedsLiveProbe/Unreachable outcome.

    Initial D2 implementation focuses on deterministic ref resolution, provider
    readiness, and Copilot live alias normalization.
    """
    del use_codex_proxy, prefer_cloud_fallback, explicit_fallback_refs

    normalized_ref = (ref or "").strip()
    if not normalized_ref:
        return Unreachable(
            reason_code="empty_model_ref",
            user_message="No model was provided.",
            technical_detail="ref was empty",
            remediation=["Select a model", "Provide provider/model_id or UUID"],
        )

    resolved, resolved_from, unresolved = await _resolve_ref(db, normalized_ref)
    if unresolved:
        return unresolved
    if not resolved:
        return Unreachable(
            reason_code="model_not_found",
            user_message=f"Requested model '{normalized_ref}' could not be found.",
            technical_detail=f"no row found for ref={normalized_ref}",
            candidates_tried=[normalized_ref],
            remediation=["Refresh model catalog", "Select an active model from the dropdown"],
        )

    model, provider = resolved

    if model.is_active is False:
        return Unreachable(
            reason_code="model_inactive",
            user_message=f"Model '{model.model_id}' is inactive.",
            technical_detail=f"model row inactive: id={model.id}",
            candidates_tried=[model.model_id],
            remediation=["Activate the model", "Choose a different model"],
        )

    if provider.is_active is False:
        return Unreachable(
            reason_code="provider_inactive",
            user_message=f"Provider '{provider.name}' is inactive.",
            technical_detail=f"provider row inactive: id={provider.id}",
            candidates_tried=[f"{provider.name}/{model.model_id}"],
            remediation=["Activate provider", "Reconnect provider credentials"],
        )

    if not _provider_is_usable(provider):
        return Unreachable(
            reason_code="provider_unusable",
            user_message=f"Provider '{provider.name}' does not have usable runtime credentials.",
            technical_detail=f"provider unusable: {provider.name}",
            candidates_tried=[f"{provider.name}/{model.model_id}"],
            remediation=["Set provider API key", "Reconnect OAuth", "Verify local provider connectivity"],
        )

    runtime_model_id = model.model_id or ""
    notes: list[str] = []

    if (provider.name or "").strip().lower() == "github-copilot":
        token = get_copilot_auth_token()
        resolved_model_id, live_models = await resolve_supported_copilot_model(runtime_model_id, token)
        if not resolved_model_id:
            preview = ", ".join(live_models[:8]) if live_models else "none"
            return Unreachable(
                reason_code="copilot_model_unavailable",
                user_message=(
                    f"GitHub Copilot does not currently expose model '{runtime_model_id}'. "
                    f"Live catalog preview: {preview}"
                ),
                technical_detail=f"copilot live catalog miss for model={runtime_model_id}",
                candidates_tried=[runtime_model_id],
                remediation=["Reconnect GitHub", "Use a model currently in live Copilot catalog"],
            )
        if resolved_model_id != runtime_model_id:
            setattr(model, "_runtime_model_id", resolved_model_id)
            runtime_model_id = resolved_model_id
            notes.append(f"copilot alias normalized to {resolved_model_id}")

    validation_status = (model.validation_status or "unverified").strip().lower()
    if validation_status == "validated":
        return Ready(
            model=model,
            provider=provider,
            runtime_model_id=runtime_model_id,
            resolved_from=resolved_from,
            notes=notes,
        )

    if _strict_validation_required() and intent in {"agentic", "pipeline", "tools"}:
        return Unreachable(
            reason_code="model_unvalidated_strict",
            user_message=(
                f"Model '{model.model_id}' is not validated and strict validation mode is enabled."
            ),
            technical_detail=f"validation_status={validation_status}, strict mode enabled",
            candidates_tried=[f"{provider.name}/{model.model_id}"],
            remediation=["Validate model in Models page", "Disable strict validation mode"],
        )

    return NeedsLiveProbe(
        model=model,
        provider=provider,
        reason_code="model_unverified",
        probe_action="runtime_call_probe",
        resolved_from=resolved_from,
        notes=notes,
    )


# ============================================================================
# PATTERN 3: Verification-aware model resolution
# ============================================================================

async def resolve_with_verification(
    db: AsyncSession,
    model_ref: str,
    feature_required: str,
    intent: ResolveIntent = "chat",
    session_id: str | None = None,
) -> ResolveResult:
    """
    Resolve model with verification check.
    
    Args:
        db: Database session
        model_ref: Model reference (model_id or provider/model_id)
        feature_required: Required capability (chat, vision, streaming, embeddings, functions)
        intent: Resolve intent (chat, agentic, pipeline, tools)
    
    Returns:
        Ready, NeedsLiveProbe, or Unreachable result
    
    Logic:
        1. Query verified models matching feature
        2. If none, query degraded models (with warning)
        3. If none, return fallback chain
        4. Log decision
    """
    normalized_feature = _normalize_feature_name(feature_required)

    # Session pin always wins over automatic selection.
    if session_id:
        pinned = await get_pinned_model_ref_for_session(db, session_id)
        if pinned:
            pinned_resolved = await resolve_model_for_runtime(db, pinned, intent=intent)
            if isinstance(pinned_resolved, (Ready, NeedsLiveProbe)):
                await log_selection_decision(
                    db,
                    feature=normalized_feature,
                    requested_model_ref=model_ref,
                    intent=intent,
                    candidates=[pinned],
                    selected=pinned_resolved.model,
                    result="success",
                    reason_code="session_pin",
                    details={"session_id": session_id},
                )
                return pinned_resolved

            await log_selection_decision(
                db,
                feature=normalized_feature,
                requested_model_ref=model_ref,
                intent=intent,
                candidates=[pinned],
                selected=None,
                result="failure",
                reason_code="session_pin_unavailable",
                details={"session_id": session_id},
            )
            return Unreachable(
                reason_code="session_pin_unavailable",
                user_message=(
                    f"Pinned model '{pinned}' for session '{session_id}' is unavailable. "
                    "Update or remove the pin to continue."
                ),
                technical_detail=f"session pin failed for session_id={session_id}, model={pinned}",
                candidates_tried=[pinned],
                remediation=["Pin a different model", "Remove session pin", "Fix provider credentials"],
            )

    # First try exact resolve
    exact = await resolve_model_for_runtime(db, model_ref, intent=intent)
    
    if isinstance(exact, Ready):
        # Check if verified and supports feature
        verification = await get_model_verification(db, exact.model.id)
        if verification and verification.verification_status == "verified":
            capabilities = verification.capabilities or {}
            if capabilities.get(normalized_feature, False):
                await log_selection_decision(
                    db,
                    feature=normalized_feature,
                    requested_model_ref=model_ref,
                    intent=intent,
                    candidates=[exact.model.model_id],
                    selected=exact.model,
                    result="success"
                )
                return exact
    
    # Try verified models for feature
    verified_models = await get_verified_models_for_feature(db, normalized_feature)
    
    if verified_models:
        # Pick first (could add priority logic)
        model, provider = verified_models[0]
        await log_selection_decision(
            db,
            feature=normalized_feature,
            requested_model_ref=model_ref,
            intent=intent,
            candidates=[m[0].model_id for m in verified_models],
            selected=model,
            result="success"
        )
        return Ready(
            model=model,
            provider=provider,
            runtime_model_id=model.model_id,
            resolved_from="verified_feature_match",
            notes=[f"Selected verified model for {normalized_feature}"]
        )
    
    # No verified models; return error
    await log_selection_decision(
        db,
        feature=normalized_feature,
        requested_model_ref=model_ref,
        intent=intent,
        candidates=[m[0].model_id for m in verified_models],
        selected=None,
        result="failure",
        reason_code="no_verified_models",
        details={"message": "No verified model matched requested feature"},
    )

    return Unreachable(
        reason_code="no_verified_models",
        user_message=f"No verified models support feature '{normalized_feature}'. "
                      f"Add/verify a model that supports this feature.",
        technical_detail=f"feature_required={normalized_feature}, no verified models match",
        candidates_tried=[model_ref],
        remediation=[
            f"Verify a model that supports {normalized_feature}",
            "Install a new provider with this capability",
            "Run 'devforgeai plugins verify' to check model status"
        ]
    )


async def get_verified_models_for_feature(
    db: AsyncSession,
    feature: str
) -> list[tuple[Model, Provider]]:
    """
    Query verified models supporting a feature.
    
    Args:
        db: Database session
        feature: Capability name (chat, vision, streaming, embeddings, functions)
    
    Returns:
        List of (Model, Provider) tuples, ordered by priority
    """
    normalized_feature = _normalize_feature_name(feature)

    stmt = (
        select(Model, Provider, ModelVerification)
        .join(Provider, Model.provider_id == Provider.id)
        .join(ModelVerification, Model.id == ModelVerification.model_id)
        .where(Model.is_active == True)
        .where(Provider.is_active == True)
        .where(ModelVerification.verification_status == "verified")
        .order_by(Model.fallback_priority.asc().nulls_last(), Model.created_at.desc())
    )
    
    results = (await db.execute(stmt)).all()
    
    matched = []
    for model, provider, verification in results:
        capabilities = verification.capabilities or {}
        if capabilities.get(normalized_feature, False):
            matched.append((model, provider))
    
    return matched


async def get_model_verification(db: AsyncSession, model_id: UUID) -> Optional[ModelVerification]:
    """Get verification record for a model."""
    stmt = select(ModelVerification).where(ModelVerification.model_id == model_id)
    return (await db.execute(stmt)).scalars().first()


async def get_pinned_model_ref_for_session(db: AsyncSession, session_id: str) -> str | None:
    """Return pinned model ref for session id, if any."""
    stmt = select(SessionModelPin).where(SessionModelPin.session_id == session_id)
    row = (await db.execute(stmt)).scalars().first()
    if not row:
        return None
    return (row.pinned_model_ref or "").strip() or None


async def log_selection_decision(
    db: AsyncSession,
    feature: str,
    requested_model_ref: str | None,
    intent: ResolveIntent | None,
    candidates: list[str],
    selected: Model | None,
    result: str,
    reason_code: str | None = None,
    details: dict | None = None,
):
    """
    Log model selection decision for debugging.
    
    Args:
        db: Database session
        feature: Feature required (chat, vision, etc.)
        candidates: List of candidate model IDs considered
        selected: Selected Model object
        result: "success" or "failure"
    """
    # Future: Store in a selection_log table for analytics
    # For now, just log
    import logging
    logger = logging.getLogger(__name__)
    selected_model_ref = selected.model_id if selected else None
    selected_provider_id = selected.provider_id if selected else None
    selected_model_id = selected.id if selected else None

    logger.info(
        "Model selection decision | feature=%s | intent=%s | requested=%s | candidates=%s | selected=%s | result=%s | reason=%s",
        feature,
        intent,
        requested_model_ref,
        candidates,
        selected_model_ref,
        result,
        reason_code,
    )

    try:
        row = ModelSelectionLog(
            requested_model_ref=requested_model_ref,
            feature=feature,
            intent=intent,
            candidates=candidates,
            selected_model_id=selected_model_id,
            selected_provider_id=selected_provider_id,
            selected_model_ref=selected_model_ref,
            result=result,
            reason_code=reason_code,
            details=details or {},
        )
        db.add(row)
        await db.flush()
    except Exception as exc:
        logger.warning("Failed to persist model selection log entry: %s", exc)


def get_fallback_chain(feature: str) -> list[str]:
    """
    Get prioritized fallback models for a feature.
    
    Args:
        feature: Feature name (chat, vision, streaming, embeddings, functions)
    
    Returns:
        Ordered list of model IDs to try
    """
    chains = {
        "vision": [
            "gpt-4o",
            "claude-opus-4-5",
            "gemini-2.5-pro",
            "gpt-4-turbo",
        ],
        "streaming": [
            "gpt-4o",
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "gemini-2.5-pro",
        ],
        "embeddings": [
            "text-embedding-3-large",
            "text-embedding-3-small",
        ],
        "functions": [
            "gpt-4o",
            "claude-opus-4-5",
            "gemini-2.5-pro",
        ],
        "chat": [
            "gpt-4o",
            "claude-opus-4-5",
            "gemini-2.5-pro",
            "gpt-4-turbo",
            "claude-sonnet-4-5",
        ]
    }
    
    return chains.get(feature, [])


def _normalize_feature_name(feature: str | None) -> str:
    return _FEATURE_ALIASES.get((feature or "chat").strip().lower(), "chat")


async def _load_user_configured_fallback_refs(
    db: AsyncSession,
    feature: str | None,
) -> list[str]:
    """Load runtime fallback order from app settings.

    Accepted value formats for `runtime_fallback_order`:
    - JSON list: ["provider/model", ...] (global order)
    - JSON object: {"default": [...], "chat": [...], "function_calling": [...], ...}
    """
    row = (await db.execute(select(AppSetting).where(AppSetting.key == "runtime_fallback_order"))).scalar_one_or_none()
    if not row or not row.value:
        return []

    try:
        payload = json.loads(row.value)
    except Exception:
        return []

    refs: list[str] = []
    normalized_feature = _normalize_feature_name(feature)

    if isinstance(payload, list):
        refs = [str(item).strip() for item in payload if str(item).strip()]
    elif isinstance(payload, dict):
        feature_specific = payload.get(normalized_feature)
        if isinstance(feature_specific, list):
            refs.extend(str(item).strip() for item in feature_specific if str(item).strip())
        default_list = payload.get("default")
        if isinstance(default_list, list):
            refs.extend(str(item).strip() for item in default_list if str(item).strip())

    # Preserve order while removing duplicates.
    deduped: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        deduped.append(ref)
    return deduped


def _feature_for_intent(intent: ResolveIntent) -> str:
    if intent in {"agentic", "tools"}:
        return "function_calling"
    return "chat"
