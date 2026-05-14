"""Pydantic schemas for the Run API."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input schemas
# ---------------------------------------------------------------------------

class RunCreate(BaseModel):
    project_id: str = "scratch"
    method_id: Optional[str] = None
    title: Optional[str] = None
    agent_id: Optional[str] = None
    model_ref: Optional[str] = None


class RunUpdate(BaseModel):
    title: Optional[str] = None
    power_tools_enabled: Optional[bool] = None
    model_ref: Optional[str] = None


class RunMessageIn(BaseModel):
    role: str = "user"
    content: str
    image_url: Optional[str] = None


class RunAttachMethod(BaseModel):
    method_id: str


class RunFork(BaseModel):
    event_id: str


class RunApprovalAction(BaseModel):
    phase_id: str
    action: str = Field(..., pattern="^(approve|skip|edit_brief)$")
    edit_payload: Optional[dict[str, Any]] = None


class RunEditRetry(BaseModel):
    new_prompt: str


class RunSwapModel(BaseModel):
    model_id: str


# ---------------------------------------------------------------------------
# Output schemas
# ---------------------------------------------------------------------------

class RunPhaseOut(BaseModel):
    id: str
    run_id: str
    index: int
    name: str
    agent_role: Optional[str] = None
    model_id: Optional[str] = None
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RunMessageOut(BaseModel):
    id: str
    run_id: str
    role: str
    content: str
    image_url: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RunEventSummary(BaseModel):
    """T2 view — no payload."""
    id: str
    run_id: str
    phase_id: Optional[str] = None
    kind: str
    summary: str
    duration_ms: Optional[int] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    cost_usd: Optional[float] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RunEventFull(RunEventSummary):
    """T3 view — includes payload for drill-down."""
    payload: dict[str, Any] = {}


class RunOut(BaseModel):
    id: str
    title: Optional[str] = None
    project_id: str
    method_id: Optional[str] = None
    state: str
    current_phase_id: Optional[str] = None
    forked_from_event_id: Optional[str] = None
    power_tools_enabled: bool = False
    extra_data: dict[str, Any] = {}
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RunDetailOut(RunOut):
    """Hydrated view with children."""
    phases: list[RunPhaseOut] = []
    messages: list[RunMessageOut] = []
    events: list[RunEventSummary] = []
