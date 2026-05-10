"""Session-scoped model pinning."""

from sqlalchemy import Column, String, UniqueConstraint
from app.database import Base
from app.models.base import BaseMixin


class SessionModelPin(Base, BaseMixin):
    """Stores pinned model references per session id."""

    __tablename__ = "session_model_pins"

    session_id = Column(String(100), nullable=False)
    pinned_model_ref = Column(String(255), nullable=False)
    pinned_by = Column(String(100), nullable=True)
    notes = Column(String(500), nullable=True)

    __table_args__ = (
        UniqueConstraint("session_id", name="uq_session_model_pins_session_id"),
    )

    def __repr__(self):
        return f"<SessionModelPin session_id={self.session_id} model={self.pinned_model_ref}>"
