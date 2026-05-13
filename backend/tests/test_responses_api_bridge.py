"""Tests for the chat-completions ↔ Responses API bridge in model_client.

The bridge exists because Responses-only models (currently gpt-5-codex) cannot
be reached via /chat/completions, but the rest of the codebase reads
``response.choices[0].message.content`` and ``response.usage.*_tokens``.

These tests pin down the translation contract so the bridge can be evolved
without silently changing what callers see.

Closes ``GAP_CLOSURE_LOG.md`` open item 1.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

import litellm

# Note: `from app.services import model_client` would resolve to the singleton
# `ModelClient` instance (services/__init__.py re-exports it under the same
# name as the module, which clobbers the submodule binding). Pull the symbols
# we need directly so the test reads them off the module.
from app.services.model_client import (
    ModelClient,
    _call_responses_api,
    _messages_to_responses_input,
    _responses_to_chat_envelope,
)


# ─── Pure translation helpers ────────────────────────────────────────────────

def test_messages_to_responses_input_system_prompt_becomes_instructions():
    """A system message is lifted out as the Responses-API `instructions`
    parameter, not concatenated into the input string."""
    instructions, body = _messages_to_responses_input([
        {"role": "system", "content": "You are a sysadmin."},
        {"role": "user", "content": "what's free disk space?"},
    ])
    assert instructions == "You are a sysadmin."
    # Single user turn: body is the raw user content (no role marker).
    assert body == "what's free disk space?"


def test_messages_to_responses_input_single_user_turn_keeps_raw_content():
    instructions, body = _messages_to_responses_input([
        {"role": "user", "content": "hi"},
    ])
    assert instructions is None
    assert body == "hi"


def test_messages_to_responses_input_multi_turn_stitches_with_role_markers():
    """Multi-turn conversations get flattened into role-prefixed segments so
    the model sees the structure. Lossy vs. structured input, but stable."""
    instructions, body = _messages_to_responses_input([
        {"role": "system", "content": "Be terse."},
        {"role": "user", "content": "ping"},
        {"role": "assistant", "content": "pong"},
        {"role": "user", "content": "ping again"},
    ])
    assert instructions == "Be terse."
    # Each remaining turn appears as its own [role] prefixed block.
    assert "[user] ping" in body
    assert "[assistant] pong" in body
    assert "[user] ping again" in body
    # Blocks are separated by a blank line so models can parse them.
    assert "\n\n" in body


def test_messages_to_responses_input_only_first_system_message_becomes_instructions():
    """If callers somehow include multiple system messages, only the first
    is hoisted to `instructions`. Subsequent ones get treated as content."""
    instructions, body = _messages_to_responses_input([
        {"role": "system", "content": "first"},
        {"role": "system", "content": "second"},
        {"role": "user", "content": "hi"},
    ])
    assert instructions == "first"
    assert "[system] second" in body
    assert "[user] hi" in body


def test_messages_to_responses_input_handles_non_string_content():
    """Tool-call replies sometimes carry structured content; the bridge
    should coerce them rather than crash."""
    instructions, body = _messages_to_responses_input([
        {"role": "user", "content": ["multi", "part"]},
    ])
    assert instructions is None
    # The list was coerced to str() — preserving information is the goal,
    # exact format is implementation detail (asserted permissively).
    assert "multi" in body and "part" in body


# ─── Envelope normalization ───────────────────────────────────────────────────

def test_responses_envelope_exposes_chat_completions_shape():
    """Downstream callers read .choices[0].message.content and
    .usage.{prompt,completion,total}_tokens. The envelope must surface
    exactly those attributes."""
    raw = SimpleNamespace(
        id="resp_abc",
        model="openai/gpt-5-codex",
        output_text="hello world",
        usage=SimpleNamespace(input_tokens=7, output_tokens=3),
    )
    env = _responses_to_chat_envelope(raw, fallback_model_id="openai/gpt-5-codex")

    assert env.id == "resp_abc"
    assert env.model == "openai/gpt-5-codex"
    assert env.object == "chat.completion"
    assert env.choices[0].message.role == "assistant"
    assert env.choices[0].message.content == "hello world"
    assert env.choices[0].finish_reason == "stop"
    assert env.usage.prompt_tokens == 7
    assert env.usage.completion_tokens == 3
    assert env.usage.total_tokens == 10
    # The raw response is preserved for callers who need it.
    assert env._raw is raw


def test_responses_envelope_falls_back_when_fields_missing():
    """Some Responses API errors return a partial object. Don't crash."""
    raw = SimpleNamespace()  # no output_text, no usage, no id
    env = _responses_to_chat_envelope(raw, fallback_model_id="openai/gpt-5-codex")

    assert env.choices[0].message.content == ""
    assert env.usage.prompt_tokens == 0
    assert env.usage.completion_tokens == 0
    assert env.usage.total_tokens == 0
    # Falls back to the model id passed in when raw.model is absent.
    assert env.model == "openai/gpt-5-codex"
    # An id is generated when absent so downstream id-keyed code paths work.
    assert isinstance(env.id, str) and len(env.id) > 0


# ─── End-to-end bridge call ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_call_responses_api_forwards_credentials_and_returns_envelope(monkeypatch):
    """The high-level bridge: given chat-completions messages + creds,
    aresponses is called with the right kwargs and the result is normalized."""
    captured: dict = {}

    async def fake_aresponses(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            id="resp_1",
            model=kwargs["model"],
            output_text="bridged response",
            usage=SimpleNamespace(input_tokens=11, output_tokens=5),
        )

    monkeypatch.setattr(litellm, "aresponses", fake_aresponses)

    result = await _call_responses_api(
        litellm_model="openai/gpt-5-codex",
        messages=[
            {"role": "system", "content": "You are a CLI."},
            {"role": "user", "content": "list files"},
        ],
        api_key="sk-test",
        api_base=None,
        extra_headers={"x-trace-id": "abc"},
        stream=False,
        temperature=0.2,
    )

    assert captured["model"] == "openai/gpt-5-codex"
    assert captured["instructions"] == "You are a CLI."
    assert captured["input"] == "list files"
    assert captured["api_key"] == "sk-test"
    assert captured["extra_headers"] == {"x-trace-id": "abc"}
    assert captured["temperature"] == 0.2
    # Bridge always calls aresponses with stream=False on the wire (see docstring).
    assert captured["stream"] is False
    # And the envelope is chat-completions-shaped.
    assert result.choices[0].message.content == "bridged response"
    assert result.usage.total_tokens == 16


@pytest.mark.asyncio
async def test_call_responses_api_streaming_wraps_as_single_chunk(monkeypatch):
    """When stream=True is requested, the bridge fetches the full response
    and yields it as a single chunk via an async generator. Downstream
    streaming consumers can iterate it without special-casing."""
    async def fake_aresponses(**_kwargs):
        return SimpleNamespace(
            id="resp_stream",
            model="openai/gpt-5-codex",
            output_text="streamed-as-single",
            usage=SimpleNamespace(input_tokens=2, output_tokens=2),
        )

    monkeypatch.setattr(litellm, "aresponses", fake_aresponses)

    generator = await _call_responses_api(
        litellm_model="openai/gpt-5-codex",
        messages=[{"role": "user", "content": "go"}],
        api_key=None,
        api_base=None,
        stream=True,
    )

    chunks = []
    async for chunk in generator:
        chunks.append(chunk)

    assert len(chunks) == 1, "single-chunk streaming wrapper should yield exactly one chunk"
    assert chunks[0].choices[0].message.content == "streamed-as-single"


# ─── Top-level call_model integration ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_call_model_routes_gpt5_codex_to_responses_bridge(monkeypatch):
    """call_model() must detect requires_openai_responses_api() and route
    through the bridge instead of acompletion. acompletion getting called
    is a hard failure."""
    from app.models import Model, Provider

    async def fake_acompletion(**_kwargs):
        raise AssertionError("Responses-only model must not enter chat-completions transport")

    captured_responses: list[dict] = []

    async def fake_aresponses(**kwargs):
        captured_responses.append(kwargs)
        return SimpleNamespace(
            id="resp_routed",
            model=kwargs["model"],
            output_text="routed via responses",
            usage=SimpleNamespace(input_tokens=3, output_tokens=3),
        )

    # services/__init__.py rebinds `app.services.model_client` to the singleton
    # instance, so the path-string form of setattr can't find acompletion on
    # the module. Reach for the real module via sys.modules.
    import sys
    monkeypatch.setattr(sys.modules["app.services.model_client"], "acompletion", fake_acompletion)
    monkeypatch.setattr(litellm, "aresponses", fake_aresponses)
    monkeypatch.setattr(ModelClient, "get_api_key", lambda _self, _provider: "sk-test")

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

    result = await ModelClient().call_model(
        model, provider, [{"role": "user", "content": "hello"}], stream=False,
    )

    assert len(captured_responses) == 1
    assert captured_responses[0]["input"] == "hello"
    assert result.choices[0].message.content == "routed via responses"


@pytest.mark.asyncio
async def test_call_model_chat_completions_models_still_go_through_acompletion(monkeypatch):
    """Negative case: a regular chat-completions model (gpt-5-mini, not a
    -codex variant) must NOT touch the Responses bridge. Prevents future
    edits to ``requires_openai_responses_api`` from accidentally rerouting
    everything through aresponses."""
    from app.models import Model, Provider

    captured_chat: list[dict] = []

    async def fake_acompletion(**kwargs):
        captured_chat.append(kwargs)
        return SimpleNamespace(
            id="chat_1",
            model=kwargs["model"],
            choices=[SimpleNamespace(message=SimpleNamespace(content="from chat"), finish_reason="stop")],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    async def fake_aresponses(**_kwargs):
        raise AssertionError("chat-completions model must NOT hit aresponses")

    # services/__init__.py rebinds `app.services.model_client` to the singleton
    # instance, so the path-string form of setattr can't find acompletion on
    # the module. Reach for the real module via sys.modules.
    import sys
    monkeypatch.setattr(sys.modules["app.services.model_client"], "acompletion", fake_acompletion)
    monkeypatch.setattr(litellm, "aresponses", fake_aresponses)
    monkeypatch.setattr(ModelClient, "get_api_key", lambda _self, _provider: "sk-test")

    provider = Provider(
        id=uuid.uuid4(),
        name="openai",
        display_name="OpenAI",
        auth_type="api_key",
        is_active=True,
    )
    model = Model(
        id=uuid.uuid4(),
        provider_id=provider.id,
        model_id="gpt-5-mini",
        display_name="GPT-5 mini",
        is_active=True,
    )

    result = await ModelClient().call_model(
        model, provider, [{"role": "user", "content": "hi"}], stream=False,
    )

    assert len(captured_chat) == 1
    assert "gpt-5-mini" in captured_chat[0]["model"]
    assert result.choices[0].message.content == "from chat"
