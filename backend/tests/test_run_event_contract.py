"""Test RunEvent contract — emit every kind, verify persisted row."""

import pytest
import pytest_asyncio
from app.models.run import EVENT_KINDS
from app.models.project import Project
from app.services.runs import create_run
from app.services.run_events import emit


async def _seed_scratch(db):
    db.add(Project(id="scratch", name="Scratch", sandbox_mode="restricted", is_system=True))
    await db.flush()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", sorted(EVENT_KINDS))
async def test_emit_known_kind(db_session, kind):
    await _seed_scratch(db_session)
    run = await create_run(db_session, project_id="scratch")
    await db_session.flush()

    event = await emit(
        db_session, run.id, kind,
        summary=f"Test {kind}",
        payload={"test_key": "test_value"},
        duration_ms=100,
        tokens_in=50,
        tokens_out=25,
        cost_usd=0.001,
    )

    assert event.id is not None
    assert event.run_id == run.id
    assert event.kind == kind
    assert event.summary == f"Test {kind}"
    assert event.payload["test_key"] == "test_value"
    assert event.duration_ms == 100
    assert event.tokens_in == 50
    assert event.tokens_out == 25


@pytest.mark.asyncio
async def test_emit_unknown_kind_still_persists(db_session):
    """Unknown kinds get a warning log but still persist."""
    await _seed_scratch(db_session)
    run = await create_run(db_session, project_id="scratch")
    await db_session.flush()

    event = await emit(db_session, run.id, "totally_unknown", summary="mystery event")
    assert event.id is not None
    assert event.kind == "totally_unknown"


@pytest.mark.asyncio
async def test_emit_minimal_fields(db_session):
    """Events with only required fields persist cleanly."""
    await _seed_scratch(db_session)
    run = await create_run(db_session, project_id="scratch")
    await db_session.flush()

    event = await emit(db_session, run.id, "tool_call", summary="ls -la")
    assert event.id is not None
    assert event.duration_ms is None
    assert event.tokens_in is None
    assert event.cost_usd is None
    assert event.payload == {}
