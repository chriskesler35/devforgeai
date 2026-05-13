"""Test power tools gating — each endpoint returns 403 when power_tools_enabled is false."""

import pytest
import pytest_asyncio
from fastapi import HTTPException
from app.models.project import Project
from app.services.runs import create_run, update_run, fork_run, edit_retry, swap_model
from app.services.run_events import emit


async def _seed_scratch(db):
    db.add(Project(id="scratch", name="Scratch", sandbox_mode="restricted", is_system=True))
    await db.flush()


async def _run_with_event_and_phase(db, power_tools=False):
    """Create a run with power tools set, an event, and a phase."""
    from app.models.run import RunPhase
    import uuid

    await _seed_scratch(db)
    run = await create_run(db, project_id="scratch", title="Test")
    run = await update_run(db, run, power_tools_enabled=power_tools)

    phase = RunPhase(
        id=str(uuid.uuid4()),
        run_id=run.id,
        index=0,
        name="Test Phase",
        status="running",
    )
    db.add(phase)
    await db.flush()

    event = await emit(db, run.id, "model_response", summary="test", phase_id=phase.id)
    await db.flush()
    return run, event, phase


@pytest.mark.asyncio
async def test_fork_blocked_when_disabled(db_session):
    run, event, _ = await _run_with_event_and_phase(db_session, power_tools=False)
    with pytest.raises(HTTPException) as exc_info:
        await fork_run(db_session, run, event.id)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_fork_allowed_when_enabled(db_session):
    run, event, _ = await _run_with_event_and_phase(db_session, power_tools=True)
    forked = await fork_run(db_session, run, event.id)
    assert forked.id != run.id


@pytest.mark.asyncio
async def test_edit_retry_blocked_when_disabled(db_session):
    run, event, _ = await _run_with_event_and_phase(db_session, power_tools=False)
    with pytest.raises(HTTPException) as exc_info:
        await edit_retry(db_session, run, event.id, "new prompt")
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_edit_retry_allowed_when_enabled(db_session):
    run, event, _ = await _run_with_event_and_phase(db_session, power_tools=True)
    intervention = await edit_retry(db_session, run, event.id, "new prompt")
    assert intervention.kind == "user_intervention"
    assert intervention.payload["new_prompt"] == "new prompt"


@pytest.mark.asyncio
async def test_swap_model_blocked_when_disabled(db_session):
    run, _, phase = await _run_with_event_and_phase(db_session, power_tools=False)
    with pytest.raises(HTTPException) as exc_info:
        await swap_model(db_session, run, phase.id, "gpt-4o")
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_swap_model_allowed_when_enabled(db_session):
    run, _, phase = await _run_with_event_and_phase(db_session, power_tools=True)
    updated_phase = await swap_model(db_session, run, phase.id, "gpt-4o")
    assert updated_phase.model_id == "gpt-4o"
