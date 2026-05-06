"""Model validation endpoint — confirms a model ID is real and returns authoritative metadata."""

import asyncio
import os
import logging
import time
from typing import Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Depends
from pydantic import BaseModel
import litellm

from app.middleware.auth import verify_api_key
from app.config import settings
from app.services.codex_oauth import (
    get_codex_oauth_tokens,
    get_codex_proxy_api_key,
    get_codex_proxy_base_url,
    get_codex_proxy_configuration_issue,
    should_use_codex_oauth_proxy,
)
from app.services.github_copilot import (
    COPILOT_API_BASE,
    exchange_for_copilot_token,
    get_copilot_headers,
    list_copilot_models,
)
from app.services.command_executor import get_first_github_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/models/validate", tags=["models"], dependencies=[Depends(verify_api_key)])

# Map provider name → litellm model prefix
PROVIDER_PREFIX = {
    "anthropic":  "",          # claude-3-haiku-20240307
    "google":     "gemini/",   # gemini/gemini-2.0-flash
    "openrouter": "openrouter/",
    "ollama":     "ollama/",
    "openai":     "",          # gpt-4o
    "openai-codex": "openai/",
    "github-copilot": "openai/",
}

# Capability fields we expose
CAPABILITY_FLAGS = {
    "chat":             "mode",                   # 'chat' mode
    "vision":           "supports_vision",
    "function_calling": "supports_function_calling",
    "streaming":        None,                     # always true for chat models
    "code":             None,                     # infer from model name
}

# provider:model_id -> unix expiry when transient failures should be treated as
# temporarily verified-for-use.
_TRANSIENT_VALIDATION_CACHE: dict[str, float] = {}


def _transient_cache_key(provider: str, model_id: str) -> str:
    return f"{(provider or '').strip().lower()}::{(model_id or '').strip().lower()}"


def _transient_ttl_seconds() -> int:
    raw = (os.environ.get("MODEL_VALIDATE_TRANSIENT_TTL_SECONDS") or "900").strip()
    try:
        ttl = int(raw)
    except ValueError:
        ttl = 900
    return max(30, ttl)


def _set_transient_verified(provider: str, model_id: str) -> None:
    _TRANSIENT_VALIDATION_CACHE[_transient_cache_key(provider, model_id)] = time.time() + _transient_ttl_seconds()


def _has_transient_verified(provider: str, model_id: str) -> bool:
    key = _transient_cache_key(provider, model_id)
    expiry = _TRANSIENT_VALIDATION_CACHE.get(key)
    if not expiry:
        return False
    if expiry <= time.time():
        _TRANSIENT_VALIDATION_CACHE.pop(key, None)
        return False
    return True


def _is_transient_validation_error(exc: Exception) -> bool:
    """Best-effort check for retryable provider failures during live probes."""
    text = f"{type(exc).__name__}: {exc}".lower()
    transient_markers = (
        "rate",
        "429",
        "503",
        "504",
        "timeout",
        "temporarily unavailable",
        "connection reset",
        "try again",
    )
    return any(marker in text for marker in transient_markers)


def _build_litellm_model(provider: str, model_id: str) -> str:
    prefix = PROVIDER_PREFIX.get(provider.lower(), "")
    if prefix and not model_id.startswith(prefix):
        return f"{prefix}{model_id}"
    return model_id


def _get_api_key(provider: str) -> Optional[str]:
    p = provider.lower()
    if p == "google":
        return (os.environ.get("GEMINI_API_KEY")
                or os.environ.get("GOOGLE_API_KEY")
                or settings.gemini_api_key
                or settings.google_api_key)
    codex_access_token = (get_codex_oauth_tokens().get("access_token") or "").strip() or None
    key_map = {
        "anthropic":  os.environ.get("ANTHROPIC_API_KEY") or settings.anthropic_api_key,
        "openrouter": os.environ.get("OPENROUTER_API_KEY") or settings.openrouter_api_key,
        # If OPENAI_API_KEY is missing, fall back to Codex CLI OAuth access_token.
        "openai": os.environ.get("OPENAI_API_KEY") or settings.openai_api_key or codex_access_token,
        "openai-codex": os.environ.get("OPENAI_API_KEY") or settings.openai_api_key or codex_access_token,
        "ollama": None,
    }
    return key_map.get(p)


def _extract_capabilities(info: dict, model_id: str) -> dict:
    caps = {
        "chat": info.get("mode") == "chat",
        "streaming": True,
        "vision": bool(info.get("supports_vision")),
        "function_calling": bool(info.get("supports_function_calling")),
        "code": any(kw in model_id.lower() for kw in ("coder", "codex", "code", "copilot", "starcoder", "deepseek-coder")),
    }
    return {k: v for k, v in caps.items() if v}


class ValidateRequest(BaseModel):
    model_id: str
    provider: str


class ValidateResponse(BaseModel):
    valid: bool
    live_verified: bool
    model_id: str                   # canonical model ID (may differ from input)
    display_name: Optional[str]
    provider: str
    litellm_model: str
    context_window: Optional[int]
    max_output_tokens: Optional[int]
    cost_per_1m_input: Optional[float]
    cost_per_1m_output: Optional[float]
    capabilities: dict
    source: str                     # "litellm_db" | "api_probe" | "unknown"
    warning: Optional[str]          # set if model found in DB but not probe-verified


async def validate_model_config(model_id: str, provider: str) -> dict:
    """Validate a model ID against the provider and return authoritative metadata."""
    provider = (provider or "").lower().strip()
    model_id = (model_id or "").strip()
    litellm_model = _build_litellm_model(provider, model_id)

    db_info = None
    try:
        db_info = litellm.get_model_info(litellm_model)
    except Exception:
        pass

    if db_info is None and provider == "ollama":
        db_info = {}

    context_window = None
    cost_input = None
    cost_output = None
    capabilities = {"chat": True, "streaming": True}
    display_name = None
    source = "unknown"
    warning = None
    max_output_tokens = None
    catalog_matched = False
    transient_failure = False

    if db_info is not None:
        source = "litellm_db"
        context_window = db_info.get("max_input_tokens") or db_info.get("max_tokens")
        max_output_tokens = db_info.get("max_output_tokens") or db_info.get("max_tokens")
        raw_in = db_info.get("input_cost_per_token")
        raw_out = db_info.get("output_cost_per_token")
        cost_input = round(raw_in * 1_000_000, 4) if raw_in else 0.0
        cost_output = round(raw_out * 1_000_000, 4) if raw_out else 0.0
        capabilities = _extract_capabilities(db_info, model_id) if db_info else capabilities
        display_name = _humanize(model_id)

    is_image_only = "imagen" in model_id.lower() or "dall-e" in model_id.lower() or "comfyui" in model_id.lower()
    probe_valid: Optional[bool] = None

    if provider != "ollama":
        try:
            from app.routes.model_sync import discover_provider_models, get_catalog_model_viability

            catalog_models, catalog_source = await discover_provider_models(provider)
            catalog_model = next((m for m in catalog_models if m.get("model_id") == model_id), None)
            if catalog_model:
                is_viable, viability_warning, _ = get_catalog_model_viability(catalog_model)
                if is_viable:
                    if catalog_source in {"provider_api", "codex_proxy"}:
                        probe_valid = True
                        source = "catalog_probe"
                        warning = None
                    else:
                        # Static catalog fallback: valid metadata, but not live-verified.
                        catalog_matched = True
                        source = f"catalog_{catalog_source}"
                        display_name = display_name or catalog_model.get("display_name")
                        context_window = context_window or catalog_model.get("ctx")
                        max_output_tokens = max_output_tokens or catalog_model.get("max_output_tokens")
                        if cost_input is None:
                            cost_input = float(catalog_model.get("input") or 0.0)
                        if cost_output is None:
                            cost_output = float(catalog_model.get("output") or 0.0)
                        if not capabilities or capabilities == {"chat": True, "streaming": True}:
                            capabilities = catalog_model.get("caps") or capabilities
                        warning = warning or "Model was found in provider catalog fallback; live verification is currently unavailable."
                else:
                    probe_valid = False
                    source = "catalog_probe"
                    warning = viability_warning
            elif catalog_source in {"provider_api", "codex_proxy"}:
                probe_valid = False
                warning = f"This model is not exposed by the live {provider} catalog."
        except Exception as e:
            logger.debug("Catalog validation fallback for %s/%s failed: %s", provider, model_id, e)

    if provider == "ollama":
        try:
            from app.routes.model_sync import fetch_ollama_models, fetch_ollama_model_info
            ollama_url = os.environ.get("OLLAMA_BASE_URL") or settings.ollama_base_url or "http://localhost:11434"
            live_models = await fetch_ollama_models(ollama_url)
            names = {m.get("name", "") for m in live_models}
            probe_valid = model_id in names
            if probe_valid:
                source = "api_probe"
                info = await fetch_ollama_model_info(model_id, ollama_url)
                model_info = info.get("model_info", info.get("details", {}))
                context_window = model_info.get("context_length") or model_info.get("num_ctx") or context_window
            else:
                warning = "Model is not currently available from the local Ollama server"
        except Exception as e:
            probe_valid = None
            warning = f"Could not verify local Ollama model — {type(e).__name__}"
    elif not is_image_only and probe_valid is None:
        api_key = _get_api_key(provider)
        try:
            kwargs = {
                "model": litellm_model,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 1,
                "stream": False,
            }
            if provider == "openai-codex":
                use_proxy = should_use_codex_oauth_proxy(provider, api_key=api_key)
                if use_proxy:
                    kwargs["api_base"] = get_codex_proxy_base_url()
                    kwargs["api_key"] = get_codex_proxy_api_key()
                elif api_key:
                    kwargs["api_key"] = api_key
                else:
                    warning = (
                        get_codex_proxy_configuration_issue()
                        or "No Codex OAuth session or OpenAI API key configured — cannot live-verify"
                    )
            elif provider == "github-copilot":
                gh_token = get_first_github_token()
                copilot_token = await exchange_for_copilot_token(gh_token) if gh_token else None
                if copilot_token:
                    live_models = await list_copilot_models(copilot_token)
                    if model_id in live_models:
                        probe_valid = True
                        source = "api_probe"
                    else:
                        probe_valid = False
                        warning = (
                            "This model is not exposed by the live GitHub Copilot catalog for the current token."
                        )
                else:
                    warning = "GitHub Copilot is not connected — cannot live-verify"
            elif provider == "openrouter":
                if api_key:
                    kwargs["api_key"] = api_key
                else:
                    warning = "No API key configured for openrouter — cannot live-verify"
            else:
                if api_key:
                    kwargs["api_key"] = api_key
                else:
                    warning = f"No API key configured for {provider} — cannot live-verify"

            if probe_valid is not False and "api_key" in kwargs:
                last_error: Optional[Exception] = None
                # Retry transient failures (e.g. rate limits) before declaring
                # live verification unavailable.
                for attempt in range(3):
                    try:
                        await litellm.acompletion(**kwargs)
                        probe_valid = True
                        source = "api_probe"
                        last_error = None
                        break
                    except litellm.exceptions.NotFoundError:
                        raise
                    except litellm.exceptions.AuthenticationError:
                        raise
                    except Exception as exc:
                        last_error = exc
                        if attempt < 2 and _is_transient_validation_error(exc):
                            await asyncio.sleep(0.5 * (2 ** attempt))
                            continue
                        raise

                if last_error is not None and probe_valid is None:
                    warning = f"Could not verify live after retries — {type(last_error).__name__}"
        except litellm.exceptions.NotFoundError:
            probe_valid = False
        except litellm.exceptions.AuthenticationError:
            probe_valid = None
            warning = "Could not verify — authentication error with provider API"
        except Exception as e:
            probe_valid = None
            warning = f"Could not verify live — {type(e).__name__}"
            transient_failure = _is_transient_validation_error(e)

    if provider == "ollama":
        valid = bool(probe_valid)
    elif probe_valid is True:
        valid = True
    elif probe_valid is False:
        valid = False
    elif db_info is not None or catalog_matched:
        valid = True
        if not warning:
            warning = "Found in model database but not live-verified"
    else:
        valid = False

    live_verified = bool(probe_valid is True and source in {"api_probe", "catalog_probe"})

    # If the model is otherwise valid but live probe failed due to a transient
    # provider condition (e.g. rate limiting), grant temporary verified-for-use
    # status so it can appear in validated lists and be used immediately.
    if valid and transient_failure:
        _set_transient_verified(provider, model_id)

    if valid and not live_verified and _has_transient_verified(provider, model_id):
        live_verified = True
        source = "transient_cache"
        warning = (
            "Temporarily marked validated due to recent transient provider failures; "
            "revalidate later for persistent live verification."
        )

    return {
        "valid": valid,
        "live_verified": live_verified,
        "model_id": model_id,
        "display_name": display_name or _humanize(model_id),
        "provider": provider,
        "litellm_model": litellm_model,
        "context_window": context_window,
        "max_output_tokens": max_output_tokens,
        "cost_per_1m_input": cost_input,
        "cost_per_1m_output": cost_output,
        "capabilities": capabilities,
        "source": source,
        "warning": warning,
    }


@router.post("", response_model=ValidateResponse)
async def validate_model(req: ValidateRequest):
    return ValidateResponse(**(await validate_model_config(req.model_id, req.provider)))


def _humanize(model_id: str) -> str:
    """Convert a model_id like 'gemini/gemini-2.0-flash' into 'Gemini 2.0 Flash'."""
    # Strip provider prefix
    parts = model_id.split("/")
    name = parts[-1]
    # Replace separators, title-case
    name = name.replace("-", " ").replace("_", " ").replace(".", " ")
    return " ".join(w.capitalize() if not w[0].isdigit() else w for w in name.split())
