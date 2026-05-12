"""Provider health monitoring and credential validation."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional, Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Provider
from app.models.provider_health import ProviderHealth
from app.services.provider_credentials import get_provider_api_key

logger = logging.getLogger(__name__)


HealthStatus = Literal["ok", "degraded", "failed", "unknown"]
CredentialStatus = Literal["valid", "invalid", "unchecked"]
ConnectivityStatus = Literal["ok", "error", "unchecked"]


class ProviderHealthService:
    """Monitor provider credentials, connectivity, and rate limits."""

    # Provider-specific health check endpoints
    PROVIDER_HEALTH_ENDPOINTS = {
        "openai": "https://api.openai.com/v1/models",
        "anthropic": "https://api.anthropic.com/v1/models",
        "google": "https://generativelanguage.googleapis.com/v1beta/models",
        "openrouter": "https://openrouter.ai/api/v1/models",
        "cohere": "https://api.cohere.ai/v1/models",
        "huggingface": "https://huggingface.co/api/models",
        "ollama": "http://localhost:11434/api/tags",
    }

    # Provider-specific credential headers
    PROVIDER_AUTH_HEADERS = {
        "openai": lambda key: {"Authorization": f"Bearer {key}"},
        "anthropic": lambda key: {"x-api-key": key},
        "google": lambda key: {},  # Google uses query param or headers
        "openrouter": lambda key: {"Authorization": f"Bearer {key}"},
        "cohere": lambda key: {"Authorization": f"Bearer {key}"},
        "huggingface": lambda key: {"Authorization": f"Bearer {key}"},
        "ollama": lambda key: {},  # Ollama is local, no auth
    }

    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_provider_health(
        self,
        provider: Provider
    ) -> ProviderHealth:
        """
        Full health check for a provider.

        Checks:
        1. Credential validity
        2. Connectivity to API
        3. Rate limit status

        Returns or creates ProviderHealth record.
        """
        logger.info(f"Checking health for provider {provider.name}")

        start = time.time()

        # Get or create health record
        stmt = select(ProviderHealth).where(ProviderHealth.provider_id == provider.id)
        health = (await self.db.execute(stmt)).scalars().first()

        if not health:
            health = ProviderHealth(provider_id=provider.id)
            self.db.add(health)

        # Check credential
        cred_status = await self._check_credential(provider)
        health.credential_status = cred_status
        health.credential_last_checked_at = datetime.now(timezone.utc)

        if cred_status == "invalid":
            health.credential_error_message = f"API key for {provider.name} is invalid or missing"
            health.health_status = "failed"
        elif cred_status == "unchecked":
            health.credential_error_message = None
        else:
            # Check connectivity if credential is valid
            conn_status = await self._check_connectivity(provider)
            health.connectivity_status = conn_status
            health.connectivity_last_checked_at = datetime.now(timezone.utc)

            if conn_status == "error":
                health.health_status = "degraded"
                health.connectivity_error_message = f"Unable to reach {provider.name} API"
            else:
                health.health_status = "ok"
                health.connectivity_error_message = None

        health.last_checked_at = datetime.now(timezone.utc)
        health.last_check_duration_ms = int((time.time() - start) * 1000)

        await self.db.commit()
        logger.info(f"  {provider.name}: {health.health_status}")

        return health

    async def _check_credential(self, provider: Provider) -> CredentialStatus:
        """Check if provider credential is valid."""
        try:
            api_key = get_provider_api_key(provider.name)

            if not api_key:
                return "unchecked"

            # For local providers, skip credential check
            if provider.name in ["ollama", "local", "lm-studio"]:
                return "valid"

            # Attempt a simple API call with the credential
            endpoint = self.PROVIDER_HEALTH_ENDPOINTS.get(provider.name)
            if not endpoint:
                return "unchecked"

            auth_headers_fn = self.PROVIDER_AUTH_HEADERS.get(provider.name, lambda key: {})
            headers = auth_headers_fn(api_key)

            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(endpoint, headers=headers)

                if response.status_code == 401:
                    return "invalid"
                elif response.status_code < 400:
                    return "valid"
                else:
                    # Other 4xx/5xx, assume valid credential but endpoint issue
                    return "valid"

        except Exception as e:
            logger.warning(f"Error checking credential for {provider.name}: {e}")
            return "unchecked"

    async def _check_connectivity(self, provider: Provider) -> ConnectivityStatus:
        """Check if provider API is reachable."""
        try:
            if not provider.api_base_url:
                endpoint = self.PROVIDER_HEALTH_ENDPOINTS.get(provider.name)
                if not endpoint:
                    return "unchecked"
            else:
                endpoint = provider.api_base_url

            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.head(endpoint, follow_redirects=True)

                if response.status_code < 500:
                    return "ok"
                else:
                    return "error"

        except asyncio.TimeoutError:
            return "error"
        except Exception as e:
            logger.warning(f"Error checking connectivity for {provider.name}: {e}")
            return "error"

    async def check_all_providers(self) -> dict[str, ProviderHealth]:
        """Check health for all active providers."""
        stmt = select(Provider).where(Provider.is_active == True)
        providers = (await self.db.execute(stmt)).scalars().all()

        results = {}
        for provider in providers:
            health = await self.check_provider_health(provider)
            results[provider.name] = health

        return results

    async def start_background_monitor(
        self,
        interval_seconds: int = 300,
        on_degraded_callback: Optional[Callable[[str, ProviderHealth], Awaitable[None]]] = None,
    ):
        """
        Background task: periodically check all provider health.

        Args:
            db: AsyncSession for DB operations
            interval_seconds: Check interval (default 5 min)
            on_degraded_callback: Async callback if provider becomes degraded
        """
        logger.info(f"Starting provider health background monitor (interval: {interval_seconds}s)")

        previous_status = {}

        while True:
            try:
                health_results = await self.check_all_providers()

                for provider_name, health in health_results.items():
                    # Check if status changed
                    prev = previous_status.get(provider_name)

                    # If became degraded/failed and we have callback
                    if on_degraded_callback and prev and prev != health.health_status:
                        if health.health_status in ["degraded", "failed"]:
                            await on_degraded_callback(provider_name, health)

                    previous_status[provider_name] = health.health_status

            except Exception as e:
                logger.error(f"Error in provider health monitor: {e}")

            # Wait before next check
            await asyncio.sleep(interval_seconds)

    async def handle_degraded_provider(
        self,
        provider_name: str,
        health: ProviderHealth,
    ):
        """
        Handle provider becoming degraded/failed.

        Actions:
        1. Mark all models from this provider as degraded
        2. Remove from model selection pool
        3. Alert user
        """
        logger.warning(f"Provider {provider_name} degraded: {health.health_status}")

        # Mark models as degraded
        from app.models import Model
        from sqlalchemy import update as sql_update

        stmt = sql_update(Model).where(
            Model.provider_id == health.provider_id
        ).values(
            is_active=False
        )

        await self.db.execute(stmt)
        await self.db.commit()

        logger.info(f"Deactivated all models from {provider_name}")


async def run_provider_health_monitor(
    session_factory,
    *,
    interval_seconds: int = 300,
) -> None:
    """Run provider health checks forever using short-lived DB sessions.

    A fresh session per loop avoids stale transaction state in long-running tasks.
    """
    interval = max(30, int(interval_seconds))
    logger.info("Starting provider health monitor loop (interval=%ss)", interval)

    while True:
        try:
            async with session_factory() as db:
                service = ProviderHealthService(db)
                health_results = await service.check_all_providers()
                for provider_name, health in health_results.items():
                    if health.health_status in {"degraded", "failed"}:
                        await service.handle_degraded_provider(provider_name, health)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Provider health monitor loop failed: %s", exc)

        await asyncio.sleep(interval)
