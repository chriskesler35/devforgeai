"""Sync data/projects.json → projects DB table on startup."""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project

logger = logging.getLogger(__name__)

_PROJECTS_FILE = Path(__file__).parent.parent.parent.parent / "data" / "projects.json"

_DIRECT_COLUMNS = {"id", "name", "path", "description", "template", "sandbox_mode"}


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        return None


def _project_from_json(data: dict[str, Any]) -> Project:
    extra = {k: v for k, v in data.items() if k not in _DIRECT_COLUMNS
             and k not in ("created_at", "updated_at")}
    return Project(
        id=data["id"],
        name=data.get("name", "Untitled"),
        path=data.get("path"),
        description=data.get("description"),
        template=data.get("template"),
        sandbox_mode=data.get("sandbox_mode", "full"),
        is_system=False,
        is_active=True,
        extra_data=extra or None,
        created_at=_parse_dt(data.get("created_at")),
        updated_at=_parse_dt(data.get("updated_at")),
    )


async def sync_projects_from_json(db: AsyncSession) -> int:
    if not _PROJECTS_FILE.exists():
        return 0

    try:
        raw = json.loads(_PROJECTS_FILE.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to read %s, skipping project sync", _PROJECTS_FILE)
        return 0

    existing_ids = set(
        (await db.execute(select(Project.id))).scalars().all()
    )

    added = 0
    for pid, pdata in raw.items():
        if pid in existing_ids:
            continue
        pdata.setdefault("id", pid)
        db.add(_project_from_json(pdata))
        added += 1

    if added:
        await db.commit()
        logger.info("Synced %d project(s) from projects.json → DB", added)

    return added
