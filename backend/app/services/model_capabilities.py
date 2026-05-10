"""Capability schema normalization and validation utilities."""

from __future__ import annotations

from typing import Any

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


def _normalize_key(raw_key: Any) -> str:
    return _CAPABILITY_KEY_ALIASES.get(str(raw_key).strip().lower(), str(raw_key).strip().lower())


def sanitize_model_capabilities(value: Any, *, context: str = "capabilities") -> tuple[dict[str, bool], list[str]]:
    """Return sanitized capability map and a list of schema issues.

    This function is tolerant: unknown keys and non-boolean values are dropped,
    and issues are returned for observability.
    """
    if value is None:
        return {}, []

    if not isinstance(value, dict):
        return {}, [f"{context} must be a JSON object (dictionary of capability -> boolean)"]

    normalized: dict[str, bool] = {}
    issues: list[str] = []

    for raw_key, raw_value in value.items():
        key = _normalize_key(raw_key)
        if key not in _ALLOWED_CAPABILITY_KEYS:
            issues.append(f"Unknown capability key '{raw_key}'")
            continue
        if not isinstance(raw_value, bool):
            issues.append(f"Capability '{raw_key}' must be boolean")
            continue
        normalized[key] = raw_value

    return normalized, issues


def validate_model_capabilities_strict(value: Any, *, context: str = "capabilities") -> dict[str, bool]:
    """Validate capabilities strictly and raise ValueError with clear guidance."""
    normalized, issues = sanitize_model_capabilities(value, context=context)
    if issues:
        allowed = ", ".join(sorted(_ALLOWED_CAPABILITY_KEYS))
        issue_text = "; ".join(issues)
        raise ValueError(f"{issue_text}. Allowed capability keys: {allowed}")
    return normalized
