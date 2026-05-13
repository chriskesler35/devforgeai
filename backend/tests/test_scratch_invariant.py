"""Test Scratch project invariant — exists after table creation, idempotent seed."""

import pytest
import pytest_asyncio
from sqlalchemy import select
from app.models.project import Project


async def _seed_scratch(db):
    existing = await db.get(Project, "scratch")
    if existing:
        return existing
    scratch = Project(
        id="scratch",
        name="Scratch",
        sandbox_mode="restricted",
        is_system=True,
        is_active=True,
    )
    db.add(scratch)
    await db.flush()
    return scratch


@pytest.mark.asyncio
async def test_scratch_exists_after_seed(db_session):
    scratch = await _seed_scratch(db_session)
    assert scratch.id == "scratch"
    assert scratch.is_system is True
    assert scratch.sandbox_mode == "restricted"
    assert scratch.is_active is True


@pytest.mark.asyncio
async def test_scratch_seed_is_idempotent(db_session):
    first = await _seed_scratch(db_session)
    second = await _seed_scratch(db_session)
    assert first.id == second.id

    result = await db_session.execute(select(Project).where(Project.id == "scratch"))
    rows = result.scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_scratch_is_active_by_default(db_session):
    scratch = await _seed_scratch(db_session)
    assert scratch.is_active is True


@pytest.mark.asyncio
async def test_run_creation_uses_scratch_default(db_session):
    await _seed_scratch(db_session)
    from app.services.runs import create_run
    run = await create_run(db_session)
    assert run.project_id == "scratch"
