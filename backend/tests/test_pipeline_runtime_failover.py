import uuid
from importlib import import_module
from datetime import datetime, timezone

import pytest


class _SessionFactory:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_pipeline_phase_failover_emits_humanized_info_message(db_session, monkeypatch):
    from app.models import Model, Provider
    from app.models.pipeline import Pipeline
    from app.models.workbench import WorkbenchSession
    from app.routes import pipelines
    from app.services import runtime_model_resolver as resolver
    model_client_module = import_module("app.services.model_client")

    monkeypatch.setattr(pipelines, "AsyncSessionLocal", lambda: _SessionFactory(db_session))
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

    bad_model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-bad",
        display_name="GPT Bad",
        is_active=True,
        validation_status="validated",
        capabilities={"chat": True, "streaming": True},
        created_at=datetime.now(timezone.utc),
    )
    good_model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-good",
        display_name="GPT Good",
        is_active=True,
        validation_status="validated",
        capabilities={"chat": True, "streaming": True},
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([bad_model, good_model])

    session_id = str(uuid.uuid4())
    pipeline_id = str(uuid.uuid4())
    db_session.add(
        WorkbenchSession(
            id=session_id,
            task="pipeline failover test",
            agent_type="coder",
            pipeline_id=pipeline_id,
            status="pending",
            files=[],
            events_log=[],
            messages=[],
        )
    )
    db_session.add(
        Pipeline(
            id=pipeline_id,
            session_id=session_id,
            method_id="gsd",
            phases=[
                {
                    "name": "Coder",
                    "role": "Rapid Prototyper",
                    "default_model": "gpt-bad",
                    "artifact_type": "md",
                    "depends_on": [],
                    "system_prompt": "Write a short implementation note.",
                }
            ],
            current_phase_index=0,
            status="pending",
            auto_approve=True,
            approvers=[],
            approval_policy="any",
            created_by="tester",
            initial_task="exercise pipeline failover",
        )
    )
    await db_session.commit()

    emitted = []

    def _capture_event(pipeline_id: str, event_type: str, **payload):
        emitted.append({"type": event_type, "payload": payload})

    async def _noop_advance(*_args, **_kwargs):
        return None

    monkeypatch.setattr(pipelines, "_push", _capture_event)
    monkeypatch.setattr(pipelines, "_advance_to_next", _noop_advance)

    class _FailingModelClient:
        async def call_model(self, model, provider, messages, stream, temperature, max_tokens):
            if model.model_id == "gpt-bad":
                raise Exception("insufficient_quota")
            raise Exception("timeout")

    monkeypatch.setattr(model_client_module, "ModelClient", _FailingModelClient)

    await pipelines._run_phase(pipeline_id, 0)

    info_messages = [
        evt["payload"].get("message", "")
        for evt in emitted
        if evt.get("type") in ("info", "model_failover")
    ]
    assert any("Model failover: switched from 'gpt-bad' to 'gpt-good'" in msg for msg in info_messages)
    assert any("out of credits" in msg.lower() for msg in info_messages)

    failover_events = [evt for evt in emitted if evt.get("type") == "model_failover"]
    assert failover_events
    assert failover_events[0]["payload"]["previous_model"] == "gpt-bad"
    assert failover_events[0]["payload"]["model_id"] == "gpt-good"

    failed_messages = [
        evt["payload"].get("error", "")
        for evt in emitted
        if evt.get("type") == "phase_failed"
    ]
    assert any("timed out" in msg.lower() for msg in failed_messages)
