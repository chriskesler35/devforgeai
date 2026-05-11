import json
import shutil
import uuid
from pathlib import Path

import pytest


def _test_root() -> Path:
    path = Path.cwd() / ".test-tmp" / "run-projects" / str(uuid.uuid4())
    path.mkdir(parents=True, exist_ok=True)
    return path


def _patch_project_registry(monkeypatch, root: Path):
    from app.services import project_registry

    data_dir = root / "data"
    monkeypatch.setattr(project_registry, "_DATA_DIR", data_dir)
    monkeypatch.setattr(project_registry, "_PROJECTS_FILE", data_dir / "projects.json")
    return project_registry


@pytest.mark.asyncio
async def test_workbench_session_auto_creates_project_when_missing(client, monkeypatch):
    root = _test_root()
    try:
        project_registry = _patch_project_registry(monkeypatch, root)

        response = await client.post(
            "/v1/workbench/sessions",
            json={
                "task": "Build a small FastAPI todo app",
                "agent_type": "coder",
                "require_spawn_approval": True,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["project_id"]
        assert payload["project_path"]

        project_path = Path(payload["project_path"])
        assert project_path.exists()
        assert (project_path / "RUN-INTAKE.md").exists()

        projects = json.loads(project_registry._PROJECTS_FILE.read_text(encoding="utf-8"))
        assert payload["project_id"] in projects
        assert projects[payload["project_id"]]["source"]["type"] == "workbench_session"
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.mark.asyncio
async def test_pipeline_creation_attaches_project_to_legacy_session(db_session, client, monkeypatch):
    from app.models.workbench import WorkbenchSession
    from app.routes import pipelines

    root = _test_root()
    _patch_project_registry(monkeypatch, root)

    async def _noop_advance(*_args, **_kwargs):
        return None

    monkeypatch.setattr(pipelines, "_advance_to_next", _noop_advance)

    session_id = str(uuid.uuid4())
    db_session.add(
        WorkbenchSession(
            id=session_id,
            task="Create a landing page",
            agent_type="coder",
            status="pending",
            files=[],
            events_log=[],
            messages=[],
        )
    )
    await db_session.commit()

    try:
        response = await client.post(
            "/v1/workbench/pipelines",
            json={
                "session_id": session_id,
                "method_id": "gsd",
                "task": "Create a landing page",
                "auto_approve": True,
            },
        )

        assert response.status_code == 200
        session = await db_session.get(WorkbenchSession, session_id)
        assert session is not None
        assert session.project_id
        assert session.project_path
        assert Path(session.project_path).exists()
    finally:
        shutil.rmtree(root, ignore_errors=True)
