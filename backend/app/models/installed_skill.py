"""Installed marketplace skill records."""

import uuid as _uuid
from sqlalchemy import Column, String, Text, JSON, DateTime
from sqlalchemy.types import CHAR
from sqlalchemy.sql import func
from app.database import Base


class InstalledSkill(Base):
    """A marketplace skill installed into the local ModelMesh workspace."""

    __tablename__ = "installed_skills"

    id = Column(CHAR(36), primary_key=True, default=lambda: str(_uuid.uuid4()))
    skill_id = Column(String(120), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    version = Column(String(80), nullable=False)
    status = Column(String(40), nullable=False, default="installed")
    trust_level = Column(String(40), nullable=True)
    install_url = Column(Text, nullable=True)
    manifest_url = Column(Text, nullable=True)
    install_path = Column(Text, nullable=False)
    manifest = Column(JSON, nullable=False)
    health_status = Column(String(40), nullable=False, default="ok")
    health_message = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    installed_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "skill_id": self.skill_id,
            "name": self.name,
            "version": self.version,
            "status": self.status,
            "trust_level": self.trust_level,
            "install_url": self.install_url,
            "manifest_url": self.manifest_url,
            "install_path": self.install_path,
            "manifest": self.manifest or {},
            "health_status": self.health_status,
            "health_message": self.health_message,
            "error": self.error,
            "installed_at": self.installed_at.isoformat() if self.installed_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
