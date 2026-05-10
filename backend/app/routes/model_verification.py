"""Model verification and health check endpoints."""

from typing import Optional
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from app.database import get_db
from app.models import Model, Provider, ModelVerification, ProviderHealth
from app.middleware.auth import verify_api_key
from app.services.model_verification import ModelVerificationService
from app.services.provider_health import ProviderHealthService

router = APIRouter(
    prefix="/v1",
    tags=["verification"],
    dependencies=[Depends(verify_api_key)]
)


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
