import uuid
from datetime import datetime, timezone

import pytest


class _SessionFactory:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_workbench_session(monkeypatch, workbench_module, db_session):
    monkeypatch.setattr(workbench_module, "AsyncSessionLocal", lambda: _SessionFactory(db_session))


@pytest.mark.asyncio
async def test_workbench_resolve_model_rejects_ambiguous_plain_model_id(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.routes import workbench
    from app.services import runtime_model_resolver as resolver

    _patch_workbench_session(monkeypatch, workbench, db_session)
    monkeypatch.setattr(resolver, "has_provider_api_key", lambda _name: True)

    openai = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    codex = Provider(
        id=uuid.uuid4(),
        name="openai-codex",
        display_name="OpenAI Codex",
        auth_type="api_key",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([openai, codex])
    await db_session.flush()

    db_session.add_all(
        [
            Model(
                id=uuid.uuid4(),
                provider_id=openai.id,
                model_id="gpt-4o",
                display_name="GPT-4o",
                is_active=True,
                validation_status="validated",
                created_at=datetime.now(timezone.utc),
            ),
            Model(
                id=uuid.uuid4(),
                provider_id=codex.id,
                model_id="gpt-4o",
                display_name="GPT-4o Codex",
                is_active=True,
                validation_status="validated",
                created_at=datetime.now(timezone.utc),
            ),
        ]
    )
    await db_session.commit()

    model, provider = await workbench._resolve_model("gpt-4o")

    assert model is None
    assert provider is None


@pytest.mark.asyncio
async def test_workbench_resolve_model_accepts_unverified_provider_qualified_ref(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.routes import workbench
    from app.services import runtime_model_resolver as resolver

    _patch_workbench_session(monkeypatch, workbench, db_session)
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

    candidate = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o-preview",
        display_name="GPT-4o Preview",
        is_active=True,
        validation_status="unverified",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(candidate)
    await db_session.commit()

    model, resolved_provider = await workbench._resolve_model("openai/gpt-4o-preview")

    assert model is not None
    assert resolved_provider is not None
    assert model.model_id == "gpt-4o-preview"
    assert resolved_provider.name == "openai"


@pytest.mark.asyncio
async def test_workbench_runtime_chain_keeps_selected_unverified_model_first(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.routes import workbench
    from app.services import runtime_model_resolver as resolver

    _patch_workbench_session(monkeypatch, workbench, db_session)
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

    selected = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o-preview",
        display_name="GPT-4o Preview",
        is_active=True,
        validation_status="unverified",
        created_at=datetime.now(timezone.utc),
    )
    backup = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-4o",
        display_name="GPT-4o",
        is_active=True,
        validation_status="validated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([selected, backup])
    await db_session.commit()

    chain, preflight_note = await workbench._build_runtime_model_chain("openai/gpt-4o-preview")

    assert len(chain) >= 1
    assert chain[0][0].model_id == "gpt-4o-preview"
    assert preflight_note is None
