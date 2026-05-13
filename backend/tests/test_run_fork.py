"""Test Run fork — inheritance, gating, validation."""

import pytest
import pytest_asyncio
from fastapi import HTTPException
from app.models.project import Project
from app.services.runs import create_run, fork_run, update_run
from app.services.run_events import emit


async def _seed_scratch(db):
    db.add(Project(id="scratch", name="Scratch", sandbox_mode="restricted", is_system=True))
    await db.flush()


async def _run_with_event(db, power_tools=True):
    await _seed_scratch(db)
    run = await create_run(db, project_id="scratch", method_id="standard", title="Source")
    run = await update_run(db, run, power_tools_enabled=power_tools)
    event = await emit(db, run.id, "model_response", summary="test response")
    await db.flush()
    return run, event


@pytest.mark.asyncio
async def test_fork_inherits_project_and_method(db_session):
    source, event = await _run_with_event(db_session)
    forked = await fork_run(db_session, source, event.id)

    assert forked.project_id == source.project_id
    assert forked.method_id == source.method_id
    assert forked.forked_from_event_id == event.id
    assert forked.state == "awaiting_input"
    assert forked.id != source.id


@pytest.mark.asyncio
async def test_fork_preserves_power_tools_setting(db_session):
    source, event = await _run_with_event(db_session, power_tools=True)
    forked = await fork_run(db_session, source, event.id)
    assert forked.power_tools_enabled is True


@pytest.mark.asyncio
async def test_fork_403_when_power_tools_disabled(db_session):
    source, event = await _run_with_event(db_session, power_tools=False)
    with pytest.raises(HTTPException) as exc_info:
        await fork_run(db_session, source, event.id)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_fork_404_when_event_not_in_source_run(db_session):
    await _seed_scratch(db_session)
    run_a = await create_run(db_session, project_id="scratch")
    run_a = await update_run(db_session, run_a, power_tools_enabled=True)
    run_b = await create_run(db_session, project_id="scratch")
    event_b = await emit(db_session, run_b.id, "model_response", summary="belongs to B")
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await fork_run(db_session, run_a, event_b.id)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_fork_404_for_nonexistent_event(db_session):
    await _seed_scratch(db_session)
    run = await create_run(db_session, project_id="scratch")
    run = await update_run(db_session, run, power_tools_enabled=True)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc_info:
        await fork_run(db_session, run, "nonexistent-event-id")
    assert exc_info.value.status_code == 404
