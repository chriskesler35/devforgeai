import uuid
from datetime import datetime, timezone

import pytest


@pytest.mark.asyncio
async def test_resolve_supported_copilot_model_maps_aliases_and_rejects_missing(monkeypatch):
    from app.services import github_copilot

    github_copilot._MODEL_LIST_CACHE.clear()

    async def fake_list_copilot_models(_token: str) -> list[str]:
        return [
            "gpt-5.5",
            "claude-sonnet-4.5",
            "claude-opus-4.5",
        ]

    monkeypatch.setattr(github_copilot, "list_copilot_models", fake_list_copilot_models)

    resolved, live_models = await github_copilot.resolve_supported_copilot_model("claude-sonnet-4-5", "token")
    assert resolved == "claude-sonnet-4.5"
    assert "gpt-5.5" in live_models

    resolved, _ = await github_copilot.resolve_supported_copilot_model("gpt-5.5-pro", "token")
    assert resolved is None


@pytest.mark.asyncio
async def test_resolve_supported_copilot_model_refreshes_stale_cache(monkeypatch):
    from app.services import github_copilot

    github_copilot._MODEL_LIST_CACHE.clear()
    github_copilot._MODEL_LIST_CACHE["token"] = (["gpt-4o", "gpt-3.5-turbo"], 9999999999.0)

    calls = {"count": 0}

    async def fake_list_copilot_models(_token: str) -> list[str]:
        calls["count"] += 1
        return ["gpt-4o", "gpt-3.5-turbo", "gpt-5.3-codex"]

    monkeypatch.setattr(github_copilot, "list_copilot_models", fake_list_copilot_models)

    resolved, live_models = await github_copilot.resolve_supported_copilot_model("gpt-5.3-codex", "token")
    assert resolved == "gpt-5.3-codex"
    assert "gpt-5.3-codex" in live_models
    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_models_validated_only_excludes_unverified_rows(client, db_session):
    from app.models import Model, Provider

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

    validated_model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o",
        display_name="GPT-4o",
        cost_per_1m_input=0,
        cost_per_1m_output=0,
        context_window=128000,
        capabilities={"chat": True, "streaming": True},
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    unverified_model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o-preview",
        display_name="GPT-4o Preview",
        cost_per_1m_input=0,
        cost_per_1m_output=0,
        context_window=128000,
        capabilities={"chat": True, "streaming": True},
        is_active=True,
        validation_status="unverified",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([validated_model, unverified_model])
    await db_session.commit()

    response = await client.get("/v1/models?validated_only=true")
    assert response.status_code == 200

    payload = response.json()
    returned_ids = {row["model_id"] for row in payload["data"]}
    assert "gpt-4o" in returned_ids
    assert "gpt-4o-preview" not in returned_ids
