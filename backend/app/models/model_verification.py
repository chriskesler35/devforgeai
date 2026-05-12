"""Model verification tracking."""

from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import BaseMixin


class ModelVerification(Base, BaseMixin):
    """Model verification and capability tracking."""
    __tablename__ = "model_verifications"
    
    model_id = Column(UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE"), nullable=False, unique=True)
    
    # Verification state
    verification_status = Column(String(20), nullable=False, default="unverified")
    # ENUM: unverified, pending, verified, failed, degraded
    
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String(100), nullable=True)
    # 'test_suite_v1', 'manual', 'regression_test_v2', etc.
    
    # Test results (JSON)
    test_results = Column(JSON, nullable=False, default={})
    # Schema:
    # {
    #   "chat_basic": {"status": "pass", "duration_ms": 234, "error": null},
    #   "chat_streaming": {"status": "pass", ...},
    #   "vision": {"status": "skip", "reason": "Model does not support vision"},
    #   ...
    # }
    
    # Capability summary (JSON)
    capabilities = Column(JSON, nullable=False, default={})
    # Schema:
    # {
    #   "chat": true,
    #   "streaming": true,
    #   "vision": false,
    #   "embeddings": false,
    #   "function_calling": true
    # }
    
    # Known issues / notes
    notes = Column(String(500), nullable=True)
    fallback_recommendations = Column(String(500), nullable=True)
    
    # Last verified timestamp
    last_verified_at = Column(DateTime, nullable=True)
    
    # Relationships
    model = relationship("Model", backref="verification")
    
    __table_args__ = (
        CheckConstraint(
            "verification_status IN ('unverified', 'pending', 'verified', 'failed', 'degraded')",
            name="check_verification_status"
        ),
    )
    
    def __repr__(self):
        return f"<ModelVerification {self.model_id} status={self.verification_status}>"
