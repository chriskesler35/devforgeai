import json
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


class _FakeRequest:
    async def is_disconnected(self):
        return False


async def _collect_sse_events(streaming_response):
    events = []
    async for chunk in streaming_response.body_iterator:
        text = chunk.decode("utf-8") if isinstance(chunk, (bytes, bytearray)) else str(chunk)
        for line in text.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


@pytest.mark.asyncio
async def test_workbench_stream_replay_backfills_canonical_fields(db_session, monkeypatch):
    from app.models.workbench import WorkbenchSession
    from app.routes import workbench

    monkeypatch.setattr(workbench, "AsyncSessionLocal", lambda: _SessionFactory(db_session))

    session_id = str(uuid.uuid4())
    db_session.add(
        WorkbenchSession(
            id=session_id,
            task="stream replay compatibility",
            agent_type="coder",
            status="completed",
            files=[],
            messages=[],
            events_log=[
                {
                    "type": "info",
                    "payload": {"message": "legacy replay event"},
                    "ts": "2026-01-01T00:00:00Z",
                },
                {
                    "type": "done",
                    "payload": {"status": "completed", "message": "done"},
                    "ts": "2026-01-01T00:00:01Z",
                },
            ],
        )
    )
    await db_session.commit()

    response = await workbench.stream_session(session_id, _FakeRequest())
    events = await _collect_sse_events(response)

    assert events[0]["type"] == "init"
    assert events[0]["canonical_type"] == "lifecycle.init"
    assert events[0]["canonical_state"] == "completed"

    replay_info = next(evt for evt in events if evt.get("type") == "info")
    assert replay_info["payload"]["message"] == "legacy replay event"
    assert replay_info["canonical_type"] == "system.info"
    assert replay_info["canonical_source"] == "workbench"


@pytest.mark.asyncio
async def test_pipeline_stream_replay_backfills_canonical_fields(db_session, monkeypatch):
    from app.models.pipeline import Pipeline
    from app.models.workbench import WorkbenchSession
    from app.routes import pipelines

    monkeypatch.setattr(pipelines, "AsyncSessionLocal", lambda: _SessionFactory(db_session))

    session_id = str(uuid.uuid4())
    pipeline_id = str(uuid.uuid4())

    db_session.add(
        WorkbenchSession(
            id=session_id,
            task="pipeline stream replay compatibility",
            agent_type="coder",
            pipeline_id=pipeline_id,
            status="completed",
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
                    "role": "Implementation Executor",
                    "artifact_type": "md",
                }
            ],
            current_phase_index=0,
            status="completed",
            auto_approve=True,
            approvers=[],
            approval_policy="any",
            created_by="tester",
            initial_task="verify stream replay canonical fields",
            created_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()

    pipelines._event_logs[pipeline_id] = [
        {
            "type": "phase_started",
            "payload": {"phase_index": 0, "phase_name": "Coder"},
            "ts": "2026-01-01T00:00:00Z",
        }
    ]

    try:
        response = await pipelines.stream_pipeline(pipeline_id, _FakeRequest())
        events = await _collect_sse_events(response)
    finally:
        pipelines._event_logs.pop(pipeline_id, None)

    assert events[0]["type"] == "init"
    assert events[0]["canonical_type"] == "lifecycle.init"
    assert events[0]["canonical_state"] == "completed"

    replay_phase = next(evt for evt in events if evt.get("type") == "phase_started")
    assert replay_phase["canonical_type"] == "phase.started"
    assert replay_phase["canonical_source"] == "pipeline"

    terminal_done = next(evt for evt in events if evt.get("type") == "pipeline_done")
    assert terminal_done["canonical_type"] == "pipeline.done"
    assert terminal_done["canonical_state"] == "completed"
