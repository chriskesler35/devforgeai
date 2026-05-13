"""Test Run state machine — one test per legal transition, one per illegal."""

import pytest
import pytest_asyncio
from app.models.run import RUN_TRANSITIONS, RUN_STATES, Run
from app.models.project import Project
from app.services.runs import transition, create_run, InvalidRunStateTransition


async def _seed_scratch(db):
    db.add(Project(id="scratch", name="Scratch", sandbox_mode="restricted", is_system=True))
    await db.flush()


async def _make_run(db, state="awaiting_input"):
    await _seed_scratch(db)
    run = await create_run(db, project_id="scratch")
    if state != "awaiting_input":
        run.state = state
        await db.flush()
    return run


# ── Legal transitions ─────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("source,target", [
    (src, tgt)
    for src, targets in RUN_TRANSITIONS.items()
    for tgt in targets
])
async def test_legal_transition(db_session, source, target):
    run = await _make_run(db_session, state=source)
    result = await transition(db_session, run, target)
    assert result.state == target
    if target == "completed":
        assert result.completed_at is not None


# ── Illegal transitions ───────────────────────────────────────────────────

def _illegal_pairs():
    pairs = []
    for src in RUN_STATES:
        allowed = RUN_TRANSITIONS.get(src, set())
        for tgt in RUN_STATES:
            if tgt not in allowed and tgt != src:
                pairs.append((src, tgt))
    return pairs


@pytest.mark.asyncio
@pytest.mark.parametrize("source,target", _illegal_pairs())
async def test_illegal_transition(db_session, source, target):
    run = await _make_run(db_session, state=source)
    with pytest.raises(InvalidRunStateTransition):
        await transition(db_session, run, target)


# ── Unknown state ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unknown_target_state(db_session):
    from fastapi import HTTPException
    run = await _make_run(db_session)
    with pytest.raises(HTTPException) as exc_info:
        await transition(db_session, run, "totally_bogus")
    assert exc_info.value.status_code == 400
