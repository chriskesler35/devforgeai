"""Project model — maps data/projects.json entries into a DB table.

The Scratch project (id='scratch') is guaranteed to exist and has
sandbox_mode='restricted' (no shell, no writes outside data/scratch/).
"""

import uuid as _uuid
from sqlalchemy import Column, String, Text, JSON, DateTime, Boolean
from sqlalchemy.sql import func
from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id           = Column(String(64), primary_key=True)
    name         = Column(Text, nullable=False)
    path         = Column(Text, nullable=True)
    description  = Column(Text, nullable=True)
    template     = Column(Text, nullable=True)
    sandbox_mode = Column(String(20), default="full", nullable=False)
    is_system    = Column(Boolean, default=False, nullable=False)
    is_active    = Column(Boolean, default=True, nullable=False)
    extra_data   = Column(JSON, default=dict)
    created_at   = Column(DateTime, server_default=func.now())
    updated_at   = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id":           self.id,
            "name":         self.name,
            "path":         self.path,
            "description":  self.description,
            "template":     self.template,
            "sandbox_mode": self.sandbox_mode,
            "is_system":    self.is_system,
            "is_active":    self.is_active,
            "extra_data":   self.extra_data or {},
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "updated_at":   self.updated_at.isoformat() if self.updated_at else None,
        }
