"""Project registry helpers for file-backed DevForgeAI projects."""

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_DATA_DIR = Path(__file__).parent.parent.parent.parent / "data"
_PROJECTS_FILE = _DATA_DIR / "projects.json"


def _load_projects() -> dict[str, Any]:
    if _PROJECTS_FILE.exists():
        try:
            return json.loads(_PROJECTS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_projects(projects: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _PROJECTS_FILE.write_text(json.dumps(projects, indent=2), encoding="utf-8")


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (value or "project").strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:60] or "project"


def _title_from_task(task: str) -> str:
    cleaned = re.sub(r"\s+", " ", (task or "").strip())
    if not cleaned:
        return "Untitled Run"
    return cleaned[:80].rstrip(" .,:;") or "Untitled Run"


def _find_by_path(projects: dict[str, Any], path: Path) -> Optional[dict[str, Any]]:
    resolved = str(path.resolve())
    for project in projects.values():
        try:
            if str(Path(project.get("path", "")).resolve()) == resolved:
                return project
        except Exception:
            continue
    return None


def _write_run_intake(project_path: Path, *, task: str, source_type: str) -> None:
    intake = project_path / "RUN-INTAKE.md"
    if intake.exists():
        return
    lines = [
        f"# Run Intake: {_title_from_task(task)}",
        "",
        "## Metadata",
        f"- Source: {source_type}",
        f"- Created At (UTC): {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Initial Task",
        "",
        task or "No task provided.",
        "",
    ]
    intake.write_text("\n".join(lines), encoding="utf-8")


def ensure_run_project(
    *,
    task: str,
    source_type: str,
    project_id: Optional[str] = None,
    project_path: Optional[str] = None,
    template: str = "blank",
) -> dict[str, Any]:
    """Resolve or create a project record for a workbench/pipeline run.

    Returns a project dict with `id` and `path`. If a project ID is provided,
    it must exist. If only a path is provided, the path is registered so the
    generated files are visible through the Projects UI. If neither is provided,
    a new project under `data/run-projects/` is created automatically.
    """
    projects = _load_projects()

    if project_id:
        project = projects.get(project_id)
        if not project:
            raise ValueError(f"Project '{project_id}' not found")
        path = Path(project["path"])
        path.mkdir(parents=True, exist_ok=True)
        _write_run_intake(path, task=task, source_type=source_type)
        return project

    title = _title_from_task(task)

    if project_path:
        path = Path(project_path).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        existing = _find_by_path(projects, path)
        if existing:
            _write_run_intake(path, task=task, source_type=source_type)
            return existing
        scaffolded = not any(path.iterdir())
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        path = _DATA_DIR / "run-projects" / f"{safe_slug(title)}-{stamp}"
        path.mkdir(parents=True, exist_ok=True)
        scaffolded = True

    if scaffolded:
        readme = path / "README.md"
        if not readme.exists():
            readme.write_text(f"# {title}\n\nCreated by a DevForgeAI run.\n", encoding="utf-8")

    _write_run_intake(path, task=task, source_type=source_type)

    now = datetime.now(timezone.utc).isoformat()
    new_id = str(uuid.uuid4())
    project = {
        "id": new_id,
        "name": title,
        "path": str(path.resolve()),
        "template": template,
        "description": f"Auto-created workspace for {source_type.replace('_', ' ')}.",
        "agents": [],
        "sandbox_mode": "full",
        "created_at": now,
        "updated_at": now,
        "scaffolded": scaffolded,
        "source": {
            "type": source_type,
            "initial_task": task,
            "intake_file": "RUN-INTAKE.md",
        },
    }
    projects[new_id] = project
    _save_projects(projects)
    return project
