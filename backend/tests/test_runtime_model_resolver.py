import uuid
from datetime import datetime, timezone

import pytest


@pytest.mark.asyncio
async def test_resolver_rejects_ambiguous_plain_model_id(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.services import runtime_model_resolver as resolver

    monkeypatch.setattr(resolver, "has_provider_api_key", lambda _name: True)

    p1 = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    p2 = Provider(
        id=uuid.uuid4(),
        name="openai-codex",
        display_name="OpenAI Codex",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([p1, p2])
    await db_session.flush()

    m1 = Model(
        id=uuid.uuid4(),
        provider_id=p1.id,
        model_id="gpt-4o",
        display_name="GPT-4o",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    m2 = Model(
        id=uuid.uuid4(),
        provider_id=p2.id,
        model_id="gpt-4o",
        display_name="GPT-4o (Codex)",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([m1, m2])
    await db_session.commit()

    result = await resolver.resolve_model_for_runtime(db_session, "gpt-4o", intent="chat")

    assert isinstance(result, resolver.Unreachable)
    assert result.reason_code == "ambiguous_model_ref"


@pytest.mark.asyncio
async def test_resolver_returns_needs_live_probe_for_unverified(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.services import runtime_model_resolver as resolver

    monkeypatch.setattr(resolver, "has_provider_api_key", lambda _name: True)

    provider = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(provider)
    await db_session.flush()

    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o-preview",
        display_name="GPT-4o Preview",
        is_active=True,
        validation_status="unverified",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(model)
    await db_session.commit()

    result = await resolver.resolve_model_for_runtime(db_session, "openai/gpt-4o-preview", intent="agentic")

    assert isinstance(result, resolver.NeedsLiveProbe)
    assert result.reason_code == "model_unverified"
    assert result.model.model_id == "gpt-4o-preview"


@pytest.mark.asyncio
async def test_resolver_copilot_alias_returns_ready(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.services import runtime_model_resolver as resolver

    monkeypatch.setattr(resolver, "has_provider_api_key", lambda _name: True)
    monkeypatch.setattr(resolver, "get_copilot_auth_token", lambda: "gho_test")

    async def fake_resolve_supported_copilot_model(model_id: str, _token: str):
        if model_id == "claude-sonnet-4-5":
            return "claude-sonnet-4.5", ["claude-sonnet-4.5", "gpt-4o"]
        return None, ["gpt-4o"]

    monkeypatch.setattr(resolver, "resolve_supported_copilot_model", fake_resolve_supported_copilot_model)

    provider = Provider(
        id=uuid.uuid4(),
        name="github-copilot",
        display_name="GitHub Copilot",
        auth_type="oauth",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(provider)
    await db_session.flush()

    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="claude-sonnet-4-5",
        display_name="Claude Sonnet 4.5",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(model)
    await db_session.commit()

    result = await resolver.resolve_model_for_runtime(db_session, "github-copilot/claude-sonnet-4-5", intent="chat")

    assert isinstance(result, resolver.Ready)
    assert result.runtime_model_id == "claude-sonnet-4.5"
    assert "normalized" in " ".join(result.notes)


@pytest.mark.asyncio
async def test_mark_runtime_validation_success_promotes_unverified(db_session):
    from app.models import Model, Provider
    from app.services.runtime_model_resolver import mark_runtime_validation_success

    provider = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(provider)
    await db_session.flush()

    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o-mini",
        display_name="GPT-4o mini",
        is_active=True,
        validation_status="unverified",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(model)
    await db_session.commit()

    changed = await mark_runtime_validation_success(db_session, model, intent="chat")
    assert changed is True

    refreshed = (await db_session.get(Model, model.id))
    assert refreshed.validation_status == "validated"
    assert refreshed.validation_source == "runtime_success:chat"
    assert refreshed.validation_error is None


@pytest.mark.asyncio
async def test_mark_runtime_validation_failure_only_on_authoritative_error(db_session):
    from app.models import Model, Provider
    from app.services.runtime_model_resolver import mark_runtime_validation_failure

    provider = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(provider)
    await db_session.flush()

    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-dead",
        display_name="Dead model",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(model)
    await db_session.commit()

    changed_transient = await mark_runtime_validation_failure(
        db_session,
        model,
        intent="chat",
        error_text="Timeout connecting to provider",
    )
    assert changed_transient is False

    changed_authoritative = await mark_runtime_validation_failure(
        db_session,
        model,
        intent="chat",
        error_text="model_not_supported by provider",
    )
    assert changed_authoritative is True

    refreshed = (await db_session.get(Model, model.id))
    assert refreshed.validation_status == "failed"
    assert refreshed.validation_error == "model_not_supported"
    assert refreshed.validation_source == "runtime_rejection:chat"


def test_runtime_error_helpers_failover_and_humanize_messages():
    from app.services.runtime_model_resolver import (
        humanize_runtime_model_error,
        should_deactivate_model_from_runtime_error,
        should_failover_on_runtime_error,
    )

    auth_err = "NotFoundError: model_not_found: does not exist"
    assert should_deactivate_model_from_runtime_error(auth_err) is True
    assert should_failover_on_runtime_error(auth_err) is True

    quota_msg = humanize_runtime_model_error("insufficient_quota", "gpt-4o")
    assert "out of credits" in quota_msg.lower()


@pytest.mark.asyncio
async def test_find_validated_runtime_recovery_model_cloud_only(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.services import runtime_model_resolver as resolver

    monkeypatch.setattr(resolver, "has_provider_api_key", lambda _name: True)

    openai = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    ollama = Provider(
        id=uuid.uuid4(),
        name="ollama",
        display_name="Ollama",
        auth_type="none",
        api_base_url="http://127.0.0.1:11434",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([openai, ollama])
    await db_session.flush()

    cloud_model = Model(
        id=uuid.uuid4(),
        provider_id=openai.id,
        model_id="gpt-4o-mini",
        display_name="GPT-4o mini",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    local_model = Model(
        id=uuid.uuid4(),
        provider_id=ollama.id,
        model_id="llama3.1:8b",
        display_name="Llama 3.1 8B",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([cloud_model, local_model])
    await db_session.commit()

    picked_model, picked_provider = await resolver.find_validated_runtime_recovery_model(
        db_session,
        intent="chat",
        cloud_only=True,
    )

    assert picked_model is not None
    assert picked_provider is not None
    assert picked_provider.name == "openai"
    assert picked_model.model_id == "gpt-4o-mini"
