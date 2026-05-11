import uuid

import pytest


def test_codex_oauth_token_is_not_treated_as_openai_api_key(monkeypatch):
    from app.services import provider_credentials

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(provider_credentials.settings, "openai_api_key", None)
    monkeypatch.setattr(provider_credentials, "has_codex_cli_auth", lambda: True)
    monkeypatch.setattr(provider_credentials, "codex_proxy_url_is_supported", lambda: True)
    monkeypatch.setattr(provider_credentials, "is_codex_proxy_reachable", lambda **_kwargs: False)

    assert provider_credentials.get_provider_api_key("openai-codex") is None
    assert provider_credentials.has_provider_api_key("openai-codex") is False


def test_codex_oauth_requires_reachable_http_proxy(monkeypatch):
    from app.services import provider_credentials

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(provider_credentials.settings, "openai_api_key", None)
    monkeypatch.setattr(provider_credentials, "has_codex_cli_auth", lambda: True)
    monkeypatch.setattr(provider_credentials, "codex_proxy_url_is_supported", lambda: True)
    monkeypatch.setattr(provider_credentials, "is_codex_proxy_reachable", lambda **_kwargs: True)

    assert provider_credentials.has_provider_api_key("openai-codex") is True


@pytest.mark.asyncio
async def test_codex_provider_uses_real_openai_api_key_without_proxy(monkeypatch):
    from importlib import import_module

    from app.models import Model, Provider

    model_client = import_module("app.services.model_client")

    captured = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return {"choices": [{"message": {"content": "ok"}}]}

    monkeypatch.setattr(model_client, "acompletion", fake_acompletion)
    monkeypatch.setattr(model_client, "should_use_codex_oauth_proxy", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(model_client, "is_codex_proxy_reachable", lambda **_kwargs: False)
    monkeypatch.setattr(model_client.ModelClient, "get_api_key", lambda _self, _provider: "sk-test")

    provider = Provider(
        id=uuid.uuid4(),
        name="openai-codex",
        display_name="OpenAI Codex",
        auth_type="oauth",
        is_active=True,
    )
    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-5",
        display_name="GPT-5",
        is_active=True,
    )

    response = await model_client.ModelClient().call_model(model, provider, [{"role": "user", "content": "hi"}], stream=False)

    assert response["choices"][0]["message"]["content"] == "ok"
    assert captured["model"] == "openai/gpt-5"
    assert captured["api_key"] == "sk-test"
    assert "api_base" not in captured


@pytest.mark.asyncio
async def test_responses_only_codex_model_does_not_remap_to_gpt5(monkeypatch):
    from importlib import import_module

    from app.models import Model, Provider

    model_client = import_module("app.services.model_client")

    async def fake_acompletion(**_kwargs):
        raise AssertionError("Responses-only model must not enter chat-completions transport")

    monkeypatch.setattr(model_client, "acompletion", fake_acompletion)
    monkeypatch.setattr(model_client.ModelClient, "get_api_key", lambda _self, _provider: "sk-test")

    provider = Provider(
        id=uuid.uuid4(),
        name="openai-codex",
        display_name="OpenAI Codex",
        auth_type="oauth",
        is_active=True,
    )
    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-5-codex",
        display_name="GPT-5 Codex",
        is_active=True,
    )

    with pytest.raises(ValueError, match="Responses API"):
        await model_client.ModelClient().call_model(model, provider, [{"role": "user", "content": "hi"}], stream=False)


@pytest.mark.asyncio
async def test_model_validate_marks_responses_only_codex_as_metadata_only(monkeypatch):
    from app.routes import model_validate

    monkeypatch.setattr(model_validate.litellm, "get_model_info", lambda _model: {"mode": "chat"})

    async def fail_discover_provider_models(_provider):
        raise AssertionError("Responses-only endpoint-constrained model should skip catalog probe")

    monkeypatch.setattr("app.routes.model_sync.discover_provider_models", fail_discover_provider_models)

    result = await model_validate.validate_model_config("gpt-5-codex", "openai-codex")

    assert result["valid"] is True
    assert result["live_verified"] is False
    assert result["source"] == "metadata_endpoint_constraint"
    assert "Responses API" in result["warning"]


def test_runtime_status_does_not_mark_bare_codex_oauth_token_usable(monkeypatch):
    from app.routes import api_keys

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(api_keys, "get_provider_api_key", lambda _provider: None)
    monkeypatch.setattr(api_keys, "get_codex_oauth_tokens", lambda: {
        "access_token": "chatgpt-oauth-token",
        "refresh_token": None,
        "auth_file": "auth.json",
    })
    monkeypatch.setattr(api_keys, "is_codex_proxy_reachable", lambda *args, **kwargs: False)
    monkeypatch.setattr(api_keys, "codex_proxy_url_is_supported", lambda: True)
    monkeypatch.setattr(api_keys, "get_codex_proxy_configuration_issue", lambda: None)
    monkeypatch.setattr(api_keys.shutil, "which", lambda _name: None)
    monkeypatch.setattr(api_keys, "_get_collaboration_user_token_count", lambda: 0)
    monkeypatch.setattr(api_keys, "get_copilot_auth_token_with_source", lambda: (None, None))

    status = api_keys._get_runtime_credential_status()

    assert status["openai_oauth"]["usable"] is False
    assert "HTTP proxy" in status["openai_oauth"]["usability_summary"]
