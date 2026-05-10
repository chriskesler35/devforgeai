"""Model verification and health check endpoints."""

from typing import Optional
from uuid import UUID
from datetime import datetime
import hashlib
import json
import hmac
from time import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from app.database import get_db
from app.config import settings
from app.models import Model, Provider, ModelSelectionLog, ModelVerification, ProviderHealth, SessionModelPin
from app.middleware.auth import verify_api_key
from app.services.model_verification import ModelVerificationService
from app.services.provider_health import ProviderHealthService

router = APIRouter(
    prefix="/v1",
    tags=["verification"],
    dependencies=[Depends(verify_api_key)]
)


_WEBHOOK_PROVIDER_ALIASES = {
    "openai": "openai",
    "openai-codex": "openai-codex",
    "codex": "openai-codex",
    "github": "github-copilot",
    "github-copilot": "github-copilot",
    "copilot": "github-copilot",
    "openrouter": "openrouter",
    "anthropic": "anthropic",
    "google": "google",
    "gemini": "google",
    "ollama": "ollama",
}

_RECENT_WEBHOOK_EVENTS: dict[str, float] = {}
_WEBHOOK_EVENT_TTL_SECONDS = 3600
_WEBHOOK_EVENT_CACHE_MAX = 2000


def _cleanup_webhook_event_cache(now_ts: float) -> None:
    stale = [k for k, ts in _RECENT_WEBHOOK_EVENTS.items() if (now_ts - ts) > _WEBHOOK_EVENT_TTL_SECONDS]
    for key in stale:
        _RECENT_WEBHOOK_EVENTS.pop(key, None)

    # Bound memory in bursty webhook scenarios.
    if len(_RECENT_WEBHOOK_EVENTS) > _WEBHOOK_EVENT_CACHE_MAX:
        oldest = sorted(_RECENT_WEBHOOK_EVENTS.items(), key=lambda item: item[1])
        remove_count = len(_RECENT_WEBHOOK_EVENTS) - _WEBHOOK_EVENT_CACHE_MAX
        for key, _ in oldest[:remove_count]:
            _RECENT_WEBHOOK_EVENTS.pop(key, None)


def _normalize_webhook_provider(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    token = raw.strip().lower()
    if not token:
        return None
    return _WEBHOOK_PROVIDER_ALIASES.get(token, token)


def _provider_from_changed_models(changed_models: list[str]) -> Optional[str]:
    providers: set[str] = set()
    for ref in changed_models:
        if not ref or "/" not in ref:
            continue
        provider = _normalize_webhook_provider(ref.split("/", 1)[0])
        if provider:
            providers.add(provider)
    if len(providers) == 1:
        return next(iter(providers))
    return None


def _extract_webhook_token(request: Request) -> str:
    auth = request.headers.get("authorization", "").strip()
    bearer = ""
    if auth.lower().startswith("bearer "):
        bearer = auth.split(" ", 1)[1].strip()
    return (
        request.headers.get("x-modelmesh-webhook-secret", "").strip()
        or request.headers.get("x-webhook-secret", "").strip()
        or bearer
    )


def _validate_catalog_webhook_auth(request: Request) -> None:
    expected = (settings.model_catalog_webhook_secret or "").strip()
    if not expected:
        # Backward-compatible default for local/dev where secret may not be configured.
        return

    provided = _extract_webhook_token(request)
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook authentication")


# ============================================================================
# Schemas
# ============================================================================

class TestResultDTO(BaseModel):
    status: str  # pass, skip, fail
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    details: dict = {}


class ModelVerificationDTO(BaseModel):
    model_id: UUID
    model_name: str
    provider: str
    verification_status: str  # verified, failed, degraded
    verified_at: Optional[datetime] = None
    days_since_verified: Optional[int] = None
    capabilities: dict = {}
    test_results: dict = {}
    fallback_recommendations: Optional[str] = None
    notes: Optional[str] = None


class ProviderHealthDTO(BaseModel):
    provider_id: UUID
    provider_name: str
    health_status: str  # ok, degraded, failed, unknown
    credential_status: str  # valid, invalid, unchecked
    connectivity_status: str  # ok, error, unchecked
    last_checked_at: Optional[datetime] = None
    last_check_duration_ms: Optional[int] = None
    rate_limit_remaining: Optional[int] = None
    rate_limit_reset_at: Optional[datetime] = None
    notes: Optional[str] = None
    message: Optional[str] = None


class ModelHealthDashboardDTO(BaseModel):
    total_models: int
    verified: int
    failed: int
    degraded: int
    by_provider: dict
    models: list[dict]


class ModelSelectionLogDTO(BaseModel):
    id: UUID
    created_at: datetime
    feature: str
    intent: Optional[str] = None
    requested_model_ref: Optional[str] = None
    candidates: list[str] = []
    selected_model_ref: Optional[str] = None
    result: str
    reason_code: Optional[str] = None
    details: dict = {}


class SessionModelPinRequest(BaseModel):
    pinned_by: Optional[str] = None
    notes: Optional[str] = None


class SessionModelPinDTO(BaseModel):
    session_id: str
    pinned_model_ref: str
    pinned_by: Optional[str] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None


class ModelCatalogModelDTO(BaseModel):
    model_id: UUID
    provider_id: UUID
    provider: str
    model_ref: str
    display_name: str
    verification_status: str
    capabilities: dict
    limits: dict


class ModelCatalogDTO(BaseModel):
    source: str
    generated_at: datetime
    ttl_seconds: int
    version: str
    count: int
    models: list[ModelCatalogModelDTO]


class ModelCatalogVersionDTO(BaseModel):
    source: str
    generated_at: datetime
    ttl_seconds: int
    version: str
    count: int


class CatalogWebhookRequest(BaseModel):
    provider: Optional[str] = None
    source: Optional[str] = None
    event_id: Optional[str] = None
    event_type: Optional[str] = None
    changed_models: list[str] = []
    reason: Optional[str] = None
    payload: dict = {}


async def _compute_catalog_version(
    db: AsyncSession,
    *,
    active_only: bool,
) -> tuple[str, int]:
    """Compute stable catalog version hash from semantic model capability content."""
    stmt = (
        select(Model, Provider, ModelVerification)
        .join(Provider, Model.provider_id == Provider.id)
        .outerjoin(ModelVerification, Model.id == ModelVerification.model_id)
    )
    if active_only:
        stmt = stmt.where(Model.is_active == True).where(Provider.is_active == True)

    rows = (await db.execute(stmt)).all()

    version_input: list[dict] = []
    for model, provider, verification in rows:
        capabilities = (
            dict((verification.capabilities or {}))
            if verification and verification.capabilities
            else dict((model.capabilities or {}))
        )
        verification_status = (
            verification.verification_status
            if verification and verification.verification_status
            else "unverified"
        )
        model_ref = f"{provider.name}/{model.model_id}"
        limits = {
            "context_window": model.context_window,
        }
        version_input.append(
            {
                "model_ref": model_ref,
                "verification_status": verification_status,
                "capabilities": capabilities,
                "limits": limits,
            }
        )

    version_payload = json.dumps(sorted(version_input, key=lambda x: x["model_ref"]), sort_keys=True)
    version = hashlib.sha256(version_payload.encode("utf-8")).hexdigest()[:16]
    return version, len(version_input)


# ============================================================================
# Model Verification Endpoints
# ============================================================================

@router.get("/models/{model_id}/verification")
async def get_model_verification(
    model_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> ModelVerificationDTO:
    """Get verification status for a model."""
    stmt = select(Model).where(Model.id == model_id)
    model = (await db.execute(stmt)).scalars().first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    stmt = select(Provider).where(Provider.id == model.provider_id)
    provider = (await db.execute(stmt)).scalars().first()
    
    stmt = select(ModelVerification).where(ModelVerification.model_id == model_id)
    verification = (await db.execute(stmt)).scalars().first()
    
    if not verification:
        return ModelVerificationDTO(
            model_id=model.id,
            model_name=model.display_name or model.model_id,
            provider=provider.name if provider else "unknown",
            verification_status="unverified",
            capabilities={},
            test_results={}
        )
    
    return ModelVerificationDTO(
        model_id=model.id,
        model_name=model.display_name or model.model_id,
        provider=provider.name if provider else "unknown",
        verification_status=verification.verification_status,
        verified_at=verification.verified_at,
        capabilities=verification.capabilities or {},
        test_results=verification.test_results or {},
        fallback_recommendations=verification.fallback_recommendations,
        notes=verification.notes
    )


@router.post("/models/{model_id}/verify")
async def verify_model(
    model_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> ModelVerificationDTO:
    """Manually trigger verification for a model."""
    stmt = select(Model).where(Model.id == model_id)
    model = (await db.execute(stmt)).scalars().first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    stmt = select(Provider).where(Provider.id == model.provider_id)
    provider = (await db.execute(stmt)).scalars().first()
    
    service = ModelVerificationService(db)
    result = await service.verify_model(model, provider, test_suite_version="manual")
    
    return ModelVerificationDTO(
        model_id=model.id,
        model_name=model.display_name or model.model_id,
        provider=provider.name if provider else "unknown",
        verification_status=result.verification_status,
        verified_at=result.verified_at,
        capabilities=result.capabilities,
        test_results={k: v for k, v in result.test_results.items()},
        fallback_recommendations=result.fallback_recommendations,
        notes=result.notes
    )


@router.post("/models/verify-all")
async def verify_all_models(
    db: AsyncSession = Depends(get_db)
) -> dict:
    """Regression test: re-verify all models (run before deploy)."""
    stmt = select(Model, Provider).join(Provider)
    results_list = (await db.execute(stmt)).all()
    
    service = ModelVerificationService(db)
    results = await service.verify_models_batch(
        [(model, provider) for model, provider in results_list],
        concurrency=5
    )
    
    summary = {
        "total": len(results),
        "verified": len([r for r in results.values() if r.verification_status == "verified"]),
        "failed": len([r for r in results.values() if r.verification_status == "failed"]),
        "models": {
            key: {
                "status": result.verification_status,
                "provider": result.provider_name
            }
            for key, result in results.items()
        }
    }
    
    return summary


@router.get("/models/health-dashboard")
async def get_model_health_dashboard(
    db: AsyncSession = Depends(get_db)
) -> ModelHealthDashboardDTO:
    """Get real-time model health metrics."""
    # Count models by status
    stmt = select(func.count(Model.id)).select_from(Model)
    total = (await db.execute(stmt)).scalar() or 0
    
    stmt = select(func.count(ModelVerification.id)).where(
        ModelVerification.verification_status == "verified"
    )
    verified = (await db.execute(stmt)).scalar() or 0
    
    stmt = select(func.count(ModelVerification.id)).where(
        ModelVerification.verification_status == "failed"
    )
    failed = (await db.execute(stmt)).scalar() or 0
    
    stmt = select(func.count(ModelVerification.id)).where(
        ModelVerification.verification_status == "degraded"
    )
    degraded = (await db.execute(stmt)).scalar() or 0
    
    # By provider
    stmt = select(Provider, func.count(Model.id)).outerjoin(Model).group_by(Provider.id)
    provider_results = (await db.execute(stmt)).all()
    
    by_provider = {}
    for provider, model_count in provider_results:
        by_provider[provider.name] = {
            "total": model_count,
            "verified": 0,
            "failed": 0,
            "degraded": 0
        }
    
    # Get verification counts per provider
    stmt = select(
        Provider,
        ModelVerification.verification_status,
        func.count(ModelVerification.id)
    ).join(Model).join(ModelVerification).group_by(Provider.id, ModelVerification.verification_status)
    
    status_results = (await db.execute(stmt)).all()
    for provider, status, count in status_results:
        if provider.name in by_provider:
            by_provider[provider.name][status] = count
    
    return ModelHealthDashboardDTO(
        total_models=total,
        verified=verified,
        failed=failed,
        degraded=degraded,
        by_provider=by_provider,
        models=[]  # TODO: Add detailed model list
    )


@router.get("/models/selection-log")
async def get_model_selection_log(
    limit: int = Query(default=100, ge=1, le=1000),
    feature: Optional[str] = Query(default=None),
    result: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[ModelSelectionLogDTO]:
    """Return durable runtime model selection decisions for debugging and audits."""
    stmt = select(ModelSelectionLog).order_by(ModelSelectionLog.created_at.desc()).limit(limit)
    if feature:
        stmt = stmt.where(ModelSelectionLog.feature == feature)
    if result:
        stmt = stmt.where(ModelSelectionLog.result == result)

    rows = (await db.execute(stmt)).scalars().all()
    return [
        ModelSelectionLogDTO(
            id=row.id,
            created_at=row.created_at,
            feature=row.feature,
            intent=row.intent,
            requested_model_ref=row.requested_model_ref,
            candidates=list(row.candidates or []),
            selected_model_ref=row.selected_model_ref,
            result=row.result,
            reason_code=row.reason_code,
            details=dict(row.details or {}),
        )
        for row in rows
    ]


@router.get("/models/catalog")
async def get_model_capability_catalog(
    active_only: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
) -> ModelCatalogDTO:
    """Backend source-of-truth capability catalog for frontend startup sync/cache."""
    stmt = (
        select(Model, Provider, ModelVerification)
        .join(Provider, Model.provider_id == Provider.id)
        .outerjoin(ModelVerification, Model.id == ModelVerification.model_id)
    )
    if active_only:
        stmt = stmt.where(Model.is_active == True).where(Provider.is_active == True)

    rows = (await db.execute(stmt)).all()

    models: list[ModelCatalogModelDTO] = []
    version_input: list[dict] = []

    for model, provider, verification in rows:
        capabilities = (
            dict((verification.capabilities or {}))
            if verification and verification.capabilities
            else dict((model.capabilities or {}))
        )
        verification_status = (
            verification.verification_status
            if verification and verification.verification_status
            else "unverified"
        )
        model_ref = f"{provider.name}/{model.model_id}"
        limits = {
            "context_window": model.context_window,
        }

        dto = ModelCatalogModelDTO(
            model_id=model.id,
            provider_id=provider.id,
            provider=provider.name,
            model_ref=model_ref,
            display_name=model.display_name or model.model_id,
            verification_status=verification_status,
            capabilities=capabilities,
            limits=limits,
        )
        models.append(dto)
        version_input.append(
            {
                "model_ref": model_ref,
                "verification_status": verification_status,
                "capabilities": capabilities,
                "limits": limits,
            }
        )

    # Stable version hash over sorted semantic content.
    version_payload = json.dumps(sorted(version_input, key=lambda x: x["model_ref"]), sort_keys=True)
    version = hashlib.sha256(version_payload.encode("utf-8")).hexdigest()[:16]

    return ModelCatalogDTO(
        source="backend",
        generated_at=datetime.utcnow(),
        ttl_seconds=1800,
        version=version,
        count=len(models),
        models=models,
    )


@router.get("/models/catalog/version")
async def get_model_capability_catalog_version(
    active_only: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
) -> ModelCatalogVersionDTO:
    """Lightweight version metadata for frontend cache invalidation checks."""
    version, count = await _compute_catalog_version(db, active_only=active_only)
    return ModelCatalogVersionDTO(
        source="backend",
        generated_at=datetime.utcnow(),
        ttl_seconds=1800,
        version=version,
        count=count,
    )


@router.post("/models/catalog/webhook")
async def refresh_catalog_from_webhook(
    request: Request,
    body: CatalogWebhookRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Webhook trigger for provider catalog updates -> refresh backend model catalog."""
    from app.routes.model_sync import run_model_sync, PROVIDER_DEFAULT_MODELS

    _validate_catalog_webhook_auth(request)

    now_ts = time()
    _cleanup_webhook_event_cache(now_ts)

    dedupe_key = (body.event_id or "").strip()
    if dedupe_key and dedupe_key in _RECENT_WEBHOOK_EVENTS:
        return {
            "ok": True,
            "duplicate": True,
            "event_id": dedupe_key,
            "provider": _normalize_webhook_provider(body.provider) or _normalize_webhook_provider(body.source),
            "message": "Duplicate webhook event ignored.",
        }

    provider_filter = (
        _normalize_webhook_provider(body.provider)
        or _normalize_webhook_provider(body.source)
        or _provider_from_changed_models(body.changed_models)
    )

    if provider_filter:
        valid_providers = set(PROVIDER_DEFAULT_MODELS.keys()) | {"ollama"}
        if provider_filter not in valid_providers:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported provider '{provider_filter}' for catalog webhook",
            )

    sync_result = await run_model_sync(
        db,
        deduplicate_existing=False,
        provider_filter=provider_filter,
    )

    if dedupe_key:
        _RECENT_WEBHOOK_EVENTS[dedupe_key] = now_ts

    return {
        "ok": True,
        "duplicate": False,
        "event_id": dedupe_key or None,
        "event_type": body.event_type,
        "provider": provider_filter,
        "source": body.source,
        "reason": body.reason,
        "changed_models": len(body.changed_models or []),
        "added": len(sync_result.get("added", [])),
        "updated": len(sync_result.get("updated", [])),
        "deactivated": len(sync_result.get("deactivated", [])),
        "ollama_available": bool(sync_result.get("ollama_available")),
    }


@router.post("/models/{model_id}/pin-session/{session_id}")
async def pin_model_for_session(
    model_id: UUID,
    session_id: str,
    body: SessionModelPinRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionModelPinDTO:
    """Pin a model for a specific session id (chat/workbench/pipeline)."""
    model = (await db.execute(select(Model).where(Model.id == model_id))).scalars().first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    provider = (await db.execute(select(Provider).where(Provider.id == model.provider_id))).scalars().first()
    model_ref = f"{provider.name}/{model.model_id}" if provider else model.model_id

    pin = (await db.execute(select(SessionModelPin).where(SessionModelPin.session_id == session_id))).scalars().first()
    if not pin:
        pin = SessionModelPin(
            session_id=session_id,
            pinned_model_ref=model_ref,
            pinned_by=body.pinned_by,
            notes=body.notes,
        )
        db.add(pin)
    else:
        pin.pinned_model_ref = model_ref
        pin.pinned_by = body.pinned_by
        pin.notes = body.notes

    await db.commit()
    await db.refresh(pin)
    return SessionModelPinDTO(
        session_id=pin.session_id,
        pinned_model_ref=pin.pinned_model_ref,
        pinned_by=pin.pinned_by,
        notes=pin.notes,
        updated_at=pin.updated_at,
    )


@router.get("/models/pin-session/{session_id}")
async def get_model_pin_for_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get current session-level model pin, if any."""
    pin = (await db.execute(select(SessionModelPin).where(SessionModelPin.session_id == session_id))).scalars().first()
    if not pin:
        return {"ok": True, "pin": None}

    dto = SessionModelPinDTO(
        session_id=pin.session_id,
        pinned_model_ref=pin.pinned_model_ref,
        pinned_by=pin.pinned_by,
        notes=pin.notes,
        updated_at=pin.updated_at,
    )
    return {"ok": True, "pin": dto.model_dump()}


@router.delete("/models/pin-session/{session_id}")
async def unpin_model_for_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Remove session-level model pin."""
    pin = (await db.execute(select(SessionModelPin).where(SessionModelPin.session_id == session_id))).scalars().first()
    if not pin:
        return {"ok": True, "message": "No pin existed for this session."}

    await db.delete(pin)
    await db.commit()
    return {"ok": True, "message": f"Removed pinned model for session '{session_id}'."}


# ============================================================================
# Provider Health Endpoints
# ============================================================================

@router.get("/providers/{provider_id}/health")
async def get_provider_health(
    provider_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> ProviderHealthDTO:
    """Get health status for a provider."""
    stmt = select(Provider).where(Provider.id == provider_id)
    provider = (await db.execute(stmt)).scalars().first()
    
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    stmt = select(ProviderHealth).where(ProviderHealth.provider_id == provider_id)
    health = (await db.execute(stmt)).scalars().first()
    
    if not health:
        return ProviderHealthDTO(
            provider_id=provider.id,
            provider_name=provider.name,
            health_status="unknown",
            credential_status="unchecked",
            connectivity_status="unchecked"
        )
    
    return ProviderHealthDTO(
        provider_id=provider.id,
        provider_name=provider.name,
        health_status=health.health_status,
        credential_status=health.credential_status or "unchecked",
        connectivity_status=health.connectivity_status or "unchecked",
        last_checked_at=health.last_checked_at,
        last_check_duration_ms=health.last_check_duration_ms,
        rate_limit_remaining=health.rate_limit_remaining,
        rate_limit_reset_at=health.rate_limit_reset_at,
        notes=health.notes
    )


@router.post("/providers/{provider_id}/health/check")
async def check_provider_health(
    provider_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> ProviderHealthDTO:
    """Manually trigger health check for a provider."""
    stmt = select(Provider).where(Provider.id == provider_id)
    provider = (await db.execute(stmt)).scalars().first()
    
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    service = ProviderHealthService(db)
    health = await service.check_provider_health(provider)
    
    return ProviderHealthDTO(
        provider_id=provider.id,
        provider_name=provider.name,
        health_status=health.health_status,
        credential_status=health.credential_status or "unchecked",
        connectivity_status=health.connectivity_status or "unchecked",
        last_checked_at=health.last_checked_at,
        last_check_duration_ms=health.last_check_duration_ms,
        notes=health.notes
    )


@router.get("/providers/health/all")
async def get_all_provider_health(
    db: AsyncSession = Depends(get_db)
) -> list[ProviderHealthDTO]:
    """Get health status for all providers."""
    stmt = select(Provider).where(Provider.is_active == True)
    providers = (await db.execute(stmt)).scalars().all()
    
    service = ProviderHealthService(db)
    
    results = []
    for provider in providers:
        health = await service.check_provider_health(provider)
        results.append(ProviderHealthDTO(
            provider_id=provider.id,
            provider_name=provider.name,
            health_status=health.health_status,
            credential_status=health.credential_status or "unchecked",
            connectivity_status=health.connectivity_status or "unchecked",
            last_checked_at=health.last_checked_at
        ))
    
    return results


@router.put("/providers/{provider_id}/credential")
async def update_provider_credential(
    provider_id: UUID,
    api_key: str,
    db: AsyncSession = Depends(get_db)
) -> ProviderHealthDTO:
    """Update provider API key and check health."""
    from app.services.provider_credentials import set_provider_api_key
    
    stmt = select(Provider).where(Provider.id == provider_id)
    provider = (await db.execute(stmt)).scalars().first()
    
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    # Update credential
    set_provider_api_key(provider.name, api_key)
    
    # Check health
    service = ProviderHealthService(db)
    health = await service.check_provider_health(provider)
    
    return ProviderHealthDTO(
        provider_id=provider.id,
        provider_name=provider.name,
        health_status=health.health_status,
        credential_status=health.credential_status or "unchecked",
        connectivity_status=health.connectivity_status or "unchecked",
        last_checked_at=health.last_checked_at,
        notes=health.notes or ("Credential valid" if health.credential_status == "valid" else "Credential invalid")
    )
