import uuid

import pytest


@pytest.mark.asyncio
async def test_pipeline_inherits_session_model_for_every_phase(client, db_session, monkeypatch):
    from app.models.workbench import WorkbenchSession
    from app.routes import pipelines

    async def _noop_advance(*_args, **_kwargs):
        return None

    monkeypatch.setattr(pipelines, "_advance_to_next", _noop_advance)

    session_id = str(uuid.uuid4())
    db_session.add(
        WorkbenchSession(
            id=session_id,
            task="Build a dashboard",
            agent_type="coder",
            model="openai/gpt-4o",
            status="pending",
            files=[],
            events_log=[],
            messages=[],
        )
    )
    await db_session.commit()

    response = await client.post(
        "/v1/workbench/pipelines",
        json={
            "session_id": session_id,
            "method_id": "gsd",
            "task": "Build a dashboard",
            "auto_approve": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["phases"]
    assert {phase.get("model") for phase in payload["phases"]} == {"openai/gpt-4o"}
    assert {phase.get("model_source") for phase in payload["phases"]} == {"session"}


@pytest.mark.asyncio
async def test_pipeline_phase_override_only_changes_that_phase(client, db_session, monkeypatch):
    from app.models.workbench import WorkbenchSession
    from app.routes import pipelines

    async def _noop_advance(*_args, **_kwargs):
        return None

    monkeypatch.setattr(pipelines, "_advance_to_next", _noop_advance)

    session_id = str(uuid.uuid4())
    db_session.add(
        WorkbenchSession(
            id=session_id,
            task="Build a dashboard",
            agent_type="coder",
            model="openai/gpt-4o",
            status="pending",
            files=[],
            events_log=[],
            messages=[],
        )
    )
    await db_session.commit()

    response = await client.post(
        "/v1/workbench/pipelines",
        json={
            "session_id": session_id,
            "method_id": "gsd",
            "task": "Build a dashboard",
            "auto_approve": True,
            "model_overrides": {"Coder": "anthropic/claude-sonnet-4"},
        },
    )

    assert response.status_code == 200
    phases = response.json()["phases"]
    by_name = {phase["name"]: phase for phase in phases}
    assert by_name["Coder"]["model"] == "anthropic/claude-sonnet-4"
    assert by_name["Coder"]["model_source"] == "phase_override"
    inherited = [phase for phase in phases if phase["name"] != "Coder"]
    assert inherited
    assert {phase.get("model") for phase in inherited} == {"openai/gpt-4o"}
    assert {phase.get("model_source") for phase in inherited} == {"session"}
