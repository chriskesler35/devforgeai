"""DevForgeAI CLI — plugin/provider management."""

import asyncio
import sys
from typing import Optional
import click
from pathlib import Path

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models import Provider, Model
from app.services.provider_credentials import set_provider_api_key
from app.routes.model_sync import PROVIDER_DEFAULT_MODELS, sync_provider_models
from app.services.model_verification import ModelVerificationService
from app.services.provider_health import ProviderHealthService


@click.group()
def cli():
    """DevForgeAI Management CLI."""
    pass


@cli.group()
def plugins():
    """Manage plugins (providers and models)."""
    pass


@plugins.command()
@click.argument("provider")
@click.option("--api-key", prompt=False, hide_input=True, default=None, help="API key for provider")
@click.option("--no-verify", is_flag=True, help="Skip verification after install")
def install(provider: str, api_key: Optional[str], no_verify: bool):
    """Install a provider and its models.
    
    Examples:
        devforgeai plugins install openai
        devforgeai plugins install anthropic --api-key sk-...
    """
    provider = provider.lower().strip()
    
    # Check if provider is supported
    if provider not in PROVIDER_DEFAULT_MODELS:
        available = list(PROVIDER_DEFAULT_MODELS.keys())
        click.echo(f"❌ Provider '{provider}' not supported.", err=True)
        click.echo(f"Available providers: {', '.join(available)}", err=True)
        sys.exit(1)
    
    click.echo(f"📦 Installing provider: {provider}")
    
    # Get API key if not provided
    if not api_key:
        click.echo(f"\n🔑 Enter API key for {provider} (or press Enter to skip):")
        api_key = click.prompt("API Key", hide_input=True, default="")
    
    if api_key:
        click.echo(f"✓ Storing API key for {provider}")
        set_provider_api_key(provider, api_key)
    else:
        click.echo("⚠ No API key provided. Local models may still work.")
    
    # Sync models
    click.echo(f"\n📥 Syncing models from {provider}...")
    try:
        asyncio.run(_sync_models_async(provider))
        click.echo(f"✓ {provider} models synced successfully")
    except Exception as e:
        click.echo(f"❌ Error syncing models: {e}", err=True)
        sys.exit(1)
    
    # Verify models
    if not no_verify:
        click.echo(f"\n🧪 Verifying models from {provider}...")
        try:
            results = asyncio.run(_verify_provider_models_async(provider))
            verified = len([r for r in results.values() if r.verification_status == "verified"])
            total = len(results)
            click.echo(f"✓ Verification complete: {verified}/{total} models passed")
        except Exception as e:
            click.echo(f"⚠ Verification error: {e}", err=True)
    
    click.echo(f"\n✅ Provider '{provider}' installed successfully!")


@plugins.command()
def list():
    """List installed providers and their model count."""
    try:
        import asyncio
        providers = asyncio.run(_list_providers_async())
        
        if not providers:
            click.echo("No providers installed yet.")
            return
        
        click.echo("\n📦 Installed Providers:\n")
        for prov_name, model_count, health_status in providers:
            status_icon = {
                "ok": "✓",
                "degraded": "⚠",
                "failed": "❌",
                "unknown": "?"
            }.get(health_status, "?")
            
            click.echo(f"  {status_icon} {prov_name:<15} ({model_count} models) [{health_status}]")
    except Exception as e:
        click.echo(f"Error listing providers: {e}", err=True)
        sys.exit(1)


@plugins.command()
@click.argument("provider", required=False)
def health(provider: Optional[str]):
    """Check provider health and credentials.
    
    Examples:
        devforgeai plugins health              # Check all providers
        devforgeai plugins health openai       # Check specific provider
    """
    try:
        results = asyncio.run(_check_health_async(provider))
        
        if not results:
            click.echo("No providers found.")
            return
        
        click.echo("\n🏥 Provider Health:\n")
        for prov_name, health in results.items():
            cred_icon = {
                "valid": "✓",
                "invalid": "❌",
                "unchecked": "?"
            }.get(health.credential_status, "?")
            
            conn_icon = {
                "ok": "✓",
                "error": "❌",
                "unchecked": "?"
            }.get(health.connectivity_status, "?")
            
            click.echo(f"  {prov_name}:")
            click.echo(f"    Status: {health.health_status}")
            click.echo(f"    Credentials: {cred_icon} {health.credential_status}")
            click.echo(f"    Connectivity: {conn_icon} {health.connectivity_status}")
            if health.notes:
                click.echo(f"    Notes: {health.notes}")
            click.echo()
    except Exception as e:
        click.echo(f"Error checking health: {e}", err=True)
        sys.exit(1)


@plugins.command()
@click.argument("provider", required=False)
@click.option("--concurrency", default=5, help="Concurrent tests (default: 5)")
def verify(provider: Optional[str], concurrency: int):
    """Verify models from a provider.
    
    Examples:
        devforgeai plugins verify              # Verify all models
        devforgeai plugins verify openai       # Verify OpenAI models
    """
    try:
        results = asyncio.run(_verify_models_async(provider, concurrency))
        
        if not results:
            click.echo("No models found.")
            return
        
        click.echo("\n🧪 Model Verification Results:\n")
        
        by_provider = {}
        for model_key, result in results.items():
            prov = result.provider_name
            if prov not in by_provider:
                by_provider[prov] = []
            by_provider[prov].append((model_key.split("/")[-1], result))
        
        for prov_name in sorted(by_provider.keys()):
            click.echo(f"  {prov_name}:")
            for model_id, result in by_provider[prov_name]:
                status_icon = {
                    "verified": "✓",
                    "failed": "❌",
                    "degraded": "⚠"
                }.get(result.verification_status, "?")
                
                click.echo(f"    {status_icon} {model_id:<30} {result.verification_status}")
            click.echo()
    except Exception as e:
        click.echo(f"Error verifying models: {e}", err=True)
        sys.exit(1)


@plugins.command()
@click.argument("provider")
@click.option("--api-key", hide_input=True, default=None, help="New API key")
def configure(provider: str, api_key: Optional[str]):
    """Configure provider credentials.
    
    Examples:
        devforgeai plugins configure openai
        devforgeai plugins configure openai --api-key sk-...
    """
    provider = provider.lower().strip()
    
    if not api_key:
        click.echo(f"Enter new API key for {provider} (or leave blank to remove):")
        api_key = click.prompt("API Key", hide_input=True, default="")
    
    if api_key:
        set_provider_api_key(provider, api_key)
        click.echo(f"✓ API key updated for {provider}")
        
        # Test connectivity
        click.echo("Testing credential...")
        try:
            health = asyncio.run(_check_provider_health_async(provider))
            if health.credential_status == "valid":
                click.echo("✓ Credential is valid")
            else:
                click.echo(f"⚠ Credential may be invalid: {health.credential_error_message}")
        except Exception as e:
            click.echo(f"⚠ Error testing credential: {e}")
    else:
        click.echo(f"Removed API key for {provider}")
        set_provider_api_key(provider, None)


# ============================================================================
# Async helpers
# ============================================================================

async def _sync_models_async(provider_name: str):
    """Sync models for a provider."""
    from app.database import async_engine
    
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        await sync_provider_models(db, provider_name)


async def _list_providers_async():
    """List all installed providers."""
    from app.database import async_engine
    
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        from sqlalchemy import select, func
        
        stmt = select(Provider, func.count(Model.id)).outerjoin(Model).group_by(Provider.id)
        results = (await db.execute(stmt)).all()
        
        provider_health_service = ProviderHealthService(db)
        
        output = []
        for provider, model_count in results:
            health = await provider_health_service.check_provider_health(provider)
            output.append((provider.name, model_count, health.health_status))
        
        return output


async def _check_health_async(provider_name: Optional[str]):
    """Check provider health."""
    from app.database import async_engine
    
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        from sqlalchemy import select
        
        if provider_name:
            stmt = select(Provider).where(Provider.name == provider_name.lower())
            provider = (await db.execute(stmt)).scalars().first()
            if not provider:
                return {}
            providers = [provider]
        else:
            stmt = select(Provider).where(Provider.is_active == True)
            providers = (await db.execute(stmt)).scalars().all()
        
        health_service = ProviderHealthService(db)
        results = {}
        
        for provider in providers:
            health = await health_service.check_provider_health(provider)
            results[provider.name] = health
        
        return results


async def _check_provider_health_async(provider_name: str):
    """Check health for a specific provider."""
    from app.database import async_engine
    
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        from sqlalchemy import select
        
        stmt = select(Provider).where(Provider.name == provider_name.lower())
        provider = (await db.execute(stmt)).scalars().first()
        
        if not provider:
            raise ValueError(f"Provider '{provider_name}' not found")
        
        health_service = ProviderHealthService(db)
        return await health_service.check_provider_health(provider)


async def _verify_models_async(provider_name: Optional[str], concurrency: int):
    """Verify models."""
    from app.database import async_engine
    
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        from sqlalchemy import select
        
        if provider_name:
            stmt = select(Provider).where(Provider.name == provider_name.lower())
            provider = (await db.execute(stmt)).scalars().first()
            if not provider:
                return {}
            stmt = select(Model, Provider).where(Model.provider_id == provider.id)
        else:
            stmt = select(Model, Provider).join(Provider)
        
        results_list = (await db.execute(stmt)).all()
        
        verification_service = ModelVerificationService(db)
        results = await verification_service.verify_models_batch(
            [(model, provider) for model, provider in results_list],
            concurrency=concurrency
        )
        
        return results


async def _verify_provider_models_async(provider_name: str):
    """Verify all models from a specific provider."""
    from app.database import async_engine
    
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        from sqlalchemy import select
        
        stmt = select(Provider).where(Provider.name == provider_name.lower())
        provider = (await db.execute(stmt)).scalars().first()
        
        if not provider:
            raise ValueError(f"Provider '{provider_name}' not found")
        
        models = (await db.execute(
            select(Model).where(Model.provider_id == provider.id)
        )).scalars().all()
        
        verification_service = ModelVerificationService(db)
        results = await verification_service.verify_models_batch(
            [(model, provider) for model in models],
            concurrency=5
        )
        
        return results


if __name__ == "__main__":
    cli()
