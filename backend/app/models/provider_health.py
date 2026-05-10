"""Provider health monitoring."""

from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Text, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import BaseMixin


class ProviderHealth(Base, BaseMixin):
    """Provider credential and connectivity health tracking."""
    __tablename__ = "provider_health"
    
    provider_id = Column(UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), nullable=False, unique=True)
    
    # Overall health state
    health_status = Column(String(20), nullable=False, default="unknown")
    # ENUM: ok, degraded, failed, unknown
    
    last_checked_at = Column(DateTime, nullable=True)
    last_check_duration_ms = Column(Integer, nullable=True)
    
    # Credential check
    credential_status = Column(String(20), nullable=True, default="unchecked")
    # ENUM: valid, invalid, unchecked
    
    credential_last_checked_at = Column(DateTime, nullable=True)
    credential_error_message = Column(Text, nullable=True)
    
    # Connectivity check
    connectivity_status = Column(String(20), nullable=True, default="unchecked")
    # ENUM: ok, error, unchecked
    
    connectivity_last_checked_at = Column(DateTime, nullable=True)
    connectivity_error_message = Column(Text, nullable=True)
    
    # Rate limit info
    rate_limit_remaining = Column(Integer, nullable=True)
    rate_limit_reset_at = Column(DateTime, nullable=True)
    
    # Notes
    notes = Column(Text, nullable=True)
    
    # Relationships
    provider = relationship("Provider", backref="health")
    
    __table_args__ = (
        CheckConstraint(
            "health_status IN ('ok', 'degraded', 'failed', 'unknown')",
            name="check_health_status"
        ),
        CheckConstraint(
            "credential_status IN ('valid', 'invalid', 'unchecked')",
            name="check_credential_status"
        ),
        CheckConstraint(
            "connectivity_status IN ('ok', 'error', 'unchecked')",
            name="check_connectivity_status"
        ),
    )
    
    def __repr__(self):
        return f"<ProviderHealth {self.provider_id} status={self.health_status}>"
