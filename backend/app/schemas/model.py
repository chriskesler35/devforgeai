"""Model schemas."""

from typing import Optional, Dict, Any
from pydantic import BaseModel, UUID4, field_validator
from datetime import datetime


_ALLOWED_CAPABILITY_KEYS = {
    "chat",
    "streaming",
    "vision",
    "embeddings",
    "embedding",
    "function_calling",
    "tools",
    "code",
    "completion",
    "image_generation",
    "video_generation",
    "audio_or_moderation",
    "legacy_completion",
}

_CAPABILITY_KEY_ALIASES = {
    "functions": "function_calling",
    "function": "function_calling",
}


def _normalize_capabilities(value: Any) -> Dict[str, bool]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("capabilities must be a JSON object (dictionary of capability -> boolean)")

    normalized: Dict[str, bool] = {}
    invalid_keys: list[str] = []
    non_bool_keys: list[str] = []

    for raw_key, raw_value in value.items():
        key = _CAPABILITY_KEY_ALIASES.get(str(raw_key).strip().lower(), str(raw_key).strip().lower())
        if key not in _ALLOWED_CAPABILITY_KEYS:
            invalid_keys.append(str(raw_key))
            continue
        if not isinstance(raw_value, bool):
            non_bool_keys.append(str(raw_key))
            continue
        normalized[key] = raw_value

    if invalid_keys:
        allowed = ", ".join(sorted(_ALLOWED_CAPABILITY_KEYS))
        raise ValueError(f"Unknown capability keys: {', '.join(invalid_keys)}. Allowed keys: {allowed}")
    if non_bool_keys:
        raise ValueError(f"Capability values must be boolean for keys: {', '.join(non_bool_keys)}")

    return normalized


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
        return _normalize_capabilities(value)


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
        return _normalize_capabilities(value)


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
