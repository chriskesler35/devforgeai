"""Run family models — the polymorphic unit of work.

A Run subsumes chat, workbench sessions, and pipeline runs into a single
first-class entity.  See docs/superpowers/specs/2026-05-12-the-run-design.md.
"""

import uuid as _uuid
from sqlalchemy import (
    Column, String, Text, JSON, DateTime, Integer, Boolean,
    ForeignKey, Numeric, Index, UniqueConstraint,
)
from sqlalchemy.types import CHAR
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


# ---------------------------------------------------------------------------
# Valid states and event kinds — kept in code so adding one is a one-file change
# ---------------------------------------------------------------------------

RUN_STATES = frozenset({
    "awaiting_input", "running", "awaiting_approval",
    "paused", "completed", "failed", "cancelled", "archived",
})

PHASE_STATUSES = frozenset({
    "queued", "running", "done", "failed", "skipped",
})

EVENT_KINDS = frozenset({
    "phase_start", "phase_end", "agent_start",
    "tool_call", "tool_result",
    "model_request", "model_response",
    "approval_gate", "user_intervention", "error",
})

# Legal state transitions: source → set of allowed targets.
# "archived" is reachable from any non-archived state.
RUN_TRANSITIONS = {
    "awaiting_input":    {"running", "cancelled", "archived"},
    "running":           {"awaiting_approval", "awaiting_input", "paused",
                          "completed", "failed", "cancelled", "archived"},
    "awaiting_approval": {"running", "cancelled", "archived"},
    "paused":            {"running", "cancelled", "archived"},
    "completed":         {"archived"},
    "failed":            {"archived"},
    "cancelled":         {"archived"},
    "archived":          set(),
}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Run(Base):
    __tablename__ = "runs"

    id                    = Column(CHAR(36), primary_key=True, default=lambda: str(_uuid.uuid4()))
    title                 = Column(Text, nullable=True)
    project_id            = Column(String(64), ForeignKey("projects.id"), nullable=False)
    method_id             = Column(Text, nullable=True)
    state                 = Column(String(30), nullable=False, default="awaiting_input")
    current_phase_id      = Column(CHAR(36), nullable=True)
    forked_from_event_id  = Column(CHAR(36), nullable=True)
    power_tools_enabled   = Column(Boolean, default=False, nullable=False)
    extra_data            = Column(JSON, default=dict)
    created_at            = Column(DateTime, server_default=func.now())
    updated_at            = Column(DateTime, server_default=func.now(), onupdate=func.now())
    completed_at          = Column(DateTime, nullable=True)

    # Relationships
    phases   = relationship("RunPhase",   back_populates="run", cascade="all, delete-orphan", order_by="RunPhase.index")
    messages = relationship("RunMessage", back_populates="run", cascade="all, delete-orphan", order_by="RunMessage.created_at")
    events   = relationship("RunEvent",   back_populates="run", cascade="all, delete-orphan", order_by="RunEvent.created_at")

    def to_dict(self, include_children=False):
        d = {
            "id":                   self.id,
            "title":                self.title,
            "project_id":           self.project_id,
            "method_id":            self.method_id,
            "state":                self.state,
            "current_phase_id":     self.current_phase_id,
            "forked_from_event_id": self.forked_from_event_id,
            "power_tools_enabled":  self.power_tools_enabled,
            "extra_data":           self.extra_data or {},
            "created_at":           self.created_at.isoformat() if self.created_at else None,
            "updated_at":           self.updated_at.isoformat() if self.updated_at else None,
            "completed_at":         self.completed_at.isoformat() if self.completed_at else None,
        }
        if include_children:
            d["phases"]   = [p.to_dict() for p in (self.phases or [])]
            d["messages"] = [m.to_dict() for m in (self.messages or [])]
            d["events"]   = [e.to_summary_dict() for e in (self.events or [])]
        return d


class RunPhase(Base):
    __tablename__ = "run_phases"

    id         = Column(CHAR(36), primary_key=True, default=lambda: str(_uuid.uuid4()))
    run_id     = Column(CHAR(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    index      = Column(Integer, nullable=False)
    name       = Column(Text, nullable=False)
    agent_role = Column(Text, nullable=True)
    model_id   = Column(String(200), nullable=True)
    status     = Column(String(20), nullable=False, default="queued")
    started_at = Column(DateTime, nullable=True)
    ended_at   = Column(DateTime, nullable=True)

    run = relationship("Run", back_populates="phases")

    __table_args__ = (
        UniqueConstraint("run_id", "index", name="uq_run_phase_index"),
        Index("ix_run_phases_run_id", "run_id"),
    )

    def to_dict(self):
        return {
            "id":         self.id,
            "run_id":     self.run_id,
            "index":      self.index,
            "name":       self.name,
            "agent_role": self.agent_role,
            "model_id":   self.model_id,
            "status":     self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at":   self.ended_at.isoformat() if self.ended_at else None,
        }


class RunMessage(Base):
    __tablename__ = "run_messages"

    id         = Column(CHAR(36), primary_key=True, default=lambda: str(_uuid.uuid4()))
    run_id     = Column(CHAR(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    role       = Column(String(20), nullable=False)
    content    = Column(Text, nullable=False)
    image_url  = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    run = relationship("Run", back_populates="messages")

    __table_args__ = (
        Index("ix_run_messages_run_created", "run_id", "created_at"),
    )

    def to_dict(self):
        return {
            "id":         self.id,
            "run_id":     self.run_id,
            "role":       self.role,
            "content":    self.content,
            "image_url":  self.image_url,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class RunEvent(Base):
    __tablename__ = "run_events"

    id          = Column(CHAR(36), primary_key=True, default=lambda: str(_uuid.uuid4()))
    run_id      = Column(CHAR(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    phase_id    = Column(CHAR(36), ForeignKey("run_phases.id", ondelete="SET NULL"), nullable=True)
    kind        = Column(String(40), nullable=False)
    summary     = Column(Text, nullable=False)
    payload     = Column(JSON, nullable=False, default=dict)
    duration_ms = Column(Integer, nullable=True)
    tokens_in   = Column(Integer, nullable=True)
    tokens_out  = Column(Integer, nullable=True)
    cost_usd    = Column(Numeric(10, 4), nullable=True)
    created_at  = Column(DateTime, server_default=func.now())

    run   = relationship("Run", back_populates="events")
    phase = relationship("RunPhase")

    __table_args__ = (
        Index("ix_run_events_run_created", "run_id", "created_at"),
        Index("ix_run_events_run_phase",   "run_id", "phase_id"),
    )

    def to_summary_dict(self):
        """T2 view — short summary without payload."""
        return {
            "id":          self.id,
            "run_id":      self.run_id,
            "phase_id":    self.phase_id,
            "kind":        self.kind,
            "summary":     self.summary,
            "duration_ms": self.duration_ms,
            "tokens_in":   self.tokens_in,
            "tokens_out":  self.tokens_out,
            "cost_usd":    float(self.cost_usd) if self.cost_usd is not None else None,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }

    def to_full_dict(self):
        """T3 view — includes full payload for drill-down."""
        d = self.to_summary_dict()
        d["payload"] = self.payload or {}
        return d
