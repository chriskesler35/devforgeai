"""Model schemas."""

from typing import Optional, Dict, Any
from pydantic import BaseModel, UUID4, field_validator
from datetime import datetime
from app.services.model_capabilities import validate_model_capabilities_strict


class ModelBase(BaseModel):
    """Base model schema."""
    model_id: str
    display_name: Optional[str] = None
    cost_per_1m_input: float = 0.0
    cost_per_1m_output: float = 0.0
    context_window: Optional[int] = None
    capabilities: Dict[str, Any] = {}
    is_active: bool = True

    @field_validator("capabilities", mode="before")
    @classmethod
    def validate_capabilities(cls, value: Any) -> Dict[str, bool]:
        return validate_model_capabilities_strict(value)


class ModelCreate(ModelBase):
    """Schema for creating a model."""
    provider_id: UUID4


class ModelUpdate(BaseModel):
    """Schema for updating a model."""
    model_id: Optional[str] = None
    display_name: Optional[str] = None
    cost_per_1m_input: Optional[float] = None
    cost_per_1m_output: Optional[float] = None
    context_window: Optional[int] = None
    capabilities: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

    @field_validator("capabilities", mode="before")
    @classmethod
    def validate_capabilities(cls, value: Any) -> Dict[str, bool] | None:
        if value is None:
            return None
        return validate_model_capabilities_strict(value)


class ModelResponse(ModelBase):
    """Schema for model response."""
    id: UUID4
    provider_id: UUID4
    provider_name: Optional[str] = None
    validation_status: str = "unverified"
    validated_at: Optional[datetime] = None
    validation_source: Optional[str] = None
    validation_warning: Optional[str] = None
    validation_error: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ModelList(BaseModel):
    """Paginated model list."""
    data: list[ModelResponse]
    total: int
    limit: int
    offset: int
    has_more: bool
