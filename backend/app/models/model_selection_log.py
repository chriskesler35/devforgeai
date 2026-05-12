"""Runtime model selection audit log."""

from sqlalchemy import Column, String, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import BaseMixin


class ModelSelectionLog(Base, BaseMixin):
    """Stores model selection decisions for deterministic routing audits."""

    __tablename__ = "model_selection_logs"

    requested_model_ref = Column(String(255), nullable=True)
    feature = Column(String(64), nullable=False)
    intent = Column(String(32), nullable=True)
    candidates = Column(JSON, nullable=False, default=[])

    selected_model_id = Column(UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    selected_provider_id = Column(UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL"), nullable=True)
    selected_model_ref = Column(String(255), nullable=True)

    result = Column(String(32), nullable=False, default="success")
    reason_code = Column(String(64), nullable=True)
    details = Column(JSON, nullable=False, default={})

    model = relationship("Model", foreign_keys=[selected_model_id])
    provider = relationship("Provider", foreign_keys=[selected_provider_id])

    def __repr__(self):
        return (
            f"<ModelSelectionLog feature={self.feature} intent={self.intent} "
            f"result={self.result} selected={self.selected_model_ref}>"
        )
