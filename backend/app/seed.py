"""Seed database with initial data."""

import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.provider import Provider
from app.models.model import Model
from app.models.persona import Persona
from app.models.agent import Agent, DEFAULT_AGENTS
from app.models.user_profile import UserProfile
import logging

logger = logging.getLogger(__name__)

DEFAULT_PROVIDERS = [
    {"id": "ollama", "name": "ollama", "display_name": "Ollama", "api_base_url": "http://localhost:11434", "auth_type": "none", "is_active": True},
    {"id": "anthropic", "name": "anthropic", "display_name": "Anthropic", "api_base_url": "https://api.anthropic.com", "auth_type": "api_key", "is_active": True},
    {"id": "google", "name": "google", "display_name": "Google", "api_base_url": "https://generativelanguage.googleapis.com", "auth_type": "api_key", "is_active": True},
    {"id": "openrouter", "name": "openrouter", "display_name": "OpenRouter", "api_base_url": "https://openrouter.ai/api", "auth_type": "api_key", "is_active": True},
    {"id": "github-copilot", "name": "github-copilot", "display_name": "GitHub Copilot", "api_base_url": "https://api.githubcopilot.com", "auth_type": "oauth", "is_active": False},
    {"id": "openai-codex", "name": "openai-codex", "display_name": "OpenAI Codex", "api_base_url": "https://api.openai.com/v1", "auth_type": "oauth", "is_active": True},
    {"id": "openai", "name": "openai", "display_name": "OpenAI", "api_base_url": "https://api.openai.com/v1", "auth_type": "api_key", "is_active": False},
]

DEFAULT_MODELS = [
    # Ollama models
    {"provider_id": "ollama", "model_id": "llama3.1:8b", "display_name": "Llama 3.1 8B", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "tools": True, "function_calling": True}},
    {"provider_id": "ollama", "model_id": "glm-5:cloud", "display_name": "GLM-5 Cloud", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "tools": True, "function_calling": True}},
    {"provider_id": "ollama", "model_id": "qwen2.5-coder:14b", "display_name": "Qwen 2.5 Coder 14B", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 32768, "capabilities": {"chat": True, "completion": True, "streaming": True, "code": True, "tools": True, "function_calling": True}},
    {"provider_id": "ollama", "model_id": "comfyui-local", "display_name": "ComfyUI Local", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": None, "capabilities": {"image_generation": True}},
    
    # Anthropic models
    {"provider_id": "anthropic", "model_id": "claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6", "cost_per_1m_input": 3.00, "cost_per_1m_output": 15.00, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True}},
    {"provider_id": "anthropic", "model_id": "claude-opus-4-6", "display_name": "Claude Opus 4.6", "cost_per_1m_input": 15.00, "cost_per_1m_output": 75.00, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True}},
    # Google
    {"provider_id": "google", "model_id": "gemini-3.1-pro-preview", "display_name": "Gemini 3.1 Pro", "cost_per_1m_input": 1.25, "cost_per_1m_output": 5.00, "context_window": 2000000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True}},
    {"provider_id": "google", "model_id": "gemini-2.5-pro", "display_name": "Gemini 2.5 Pro", "cost_per_1m_input": 1.25, "cost_per_1m_output": 5.00, "context_window": 1000000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True}},
    {"provider_id": "google", "model_id": "gemini-imagen", "display_name": "Gemini Imagen", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": None, "capabilities": {"image_generation": True}},
    # OpenRouter
    {"provider_id": "openrouter", "model_id": "anthropic/claude-sonnet-4", "display_name": "Claude Sonnet 4 (OpenRouter)", "cost_per_1m_input": 3.00, "cost_per_1m_output": 15.00, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True}},
    {"provider_id": "openrouter", "model_id": "anthropic/claude-opus-4", "display_name": "Claude Opus 4 (OpenRouter)", "cost_per_1m_input": 15.00, "cost_per_1m_output": 75.00, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True}},
    {"provider_id": "openrouter", "model_id": "openai/gpt-4.1", "display_name": "GPT-4.1 (OpenRouter)", "cost_per_1m_input": 2.50, "cost_per_1m_output": 10.00, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True}},
    # GitHub Copilot (free with Copilot subscription -- set GITHUB_TOKEN or sign in with GitHub)
    {"provider_id": "github-copilot", "model_id": "gpt-4o", "display_name": "GPT-4o (GitHub Copilot)", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True, "code": True}},
    {"provider_id": "github-copilot", "model_id": "gpt-4.1", "display_name": "GPT-4.1 (GitHub Copilot)", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "code": True}},
    {"provider_id": "github-copilot", "model_id": "claude-3.5-sonnet", "display_name": "Claude 3.5 Sonnet (Copilot)", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True, "code": True}},
    {"provider_id": "github-copilot", "model_id": "gemini-2.0-flash-001", "display_name": "Gemini 2.0 Flash (Copilot)", "cost_per_1m_input": 0, "cost_per_1m_output": 0, "context_window": 1000000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True, "code": True}},
    # OpenAI Codex (set OPENAI_API_KEY or run `codex auth`)
    {"provider_id": "openai-codex", "model_id": "gpt-5", "display_name": "GPT-5 (Codex OAuth)", "cost_per_1m_input": 1.25, "cost_per_1m_output": 10.00, "context_window": 400000, "capabilities": {"chat": True, "completion": True, "streaming": True, "code": True}},
    {"provider_id": "openai-codex", "model_id": "gpt-5-mini", "display_name": "GPT-5 Mini (Codex OAuth)", "cost_per_1m_input": 0.25, "cost_per_1m_output": 2.00, "context_window": 400000, "capabilities": {"chat": True, "completion": True, "streaming": True, "code": True}},
    {"provider_id": "openai-codex", "model_id": "gpt-4.1", "display_name": "GPT-4.1 (Codex OAuth)", "cost_per_1m_input": 2.00, "cost_per_1m_output": 8.00, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True, "code": True}},
    {"provider_id": "openai-codex", "model_id": "o4-mini", "display_name": "o4 Mini (Codex OAuth)", "cost_per_1m_input": 1.10, "cost_per_1m_output": 4.40, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True, "code": True}},
    {"provider_id": "openai-codex", "model_id": "codex-mini-latest", "display_name": "Codex Mini Latest", "cost_per_1m_input": 1.50, "cost_per_1m_output": 6.00, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True, "code": True}},
    # OpenAI standard (set OPENAI_API_KEY)
    {"provider_id": "openai", "model_id": "gpt-4o", "display_name": "GPT-4o", "cost_per_1m_input": 2.50, "cost_per_1m_output": 10.00, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True}},
    {"provider_id": "openai", "model_id": "gpt-4o-mini", "display_name": "GPT-4o Mini", "cost_per_1m_input": 0.15, "cost_per_1m_output": 0.60, "context_window": 128000, "capabilities": {"chat": True, "completion": True, "streaming": True, "vision": True}},
    {"provider_id": "openai", "model_id": "o3-mini", "display_name": "o3 Mini", "cost_per_1m_input": 1.10, "cost_per_1m_output": 4.40, "context_window": 200000, "capabilities": {"chat": True, "completion": True, "streaming": True}},
]

DEFAULT_PERSONAS = [
    {"name": "Default", "description": "General-purpose assistant", "system_prompt": "You are a helpful AI assistant. Provide clear, accurate, and helpful responses.", "memory_enabled": True, "max_memory_messages": 10, "is_default": True, "primary_model": "llama3.1:8b"},
    {"name": "Coder", "description": "Expert programmer and code reviewer", "system_prompt": "You are an expert programmer. Help with coding tasks, debug issues, and write clean code. Follow best practices and explain your reasoning.", "memory_enabled": True, "max_memory_messages": 20, "is_default": False, "primary_model": "llama3.1:8b"},
    {"name": "Creative", "description": "Creative writer and brainstormer", "system_prompt": "You are a creative assistant. Help with writing, brainstorming, and creative projects. Think outside the box and offer unique perspectives.", "memory_enabled": True, "max_memory_messages": 15, "is_default": False, "primary_model": "llama3.1:8b"},
]


async def seed_database(db: AsyncSession):
    """Seed database with default data if empty."""
    result = await db.execute(select(Provider).limit(1))
    if result.scalar_one_or_none():
        logger.info("Database already seeded, skipping")
        return

    logger.info("Seeding database with initial data...")

    user = UserProfile(id=uuid.uuid4(), name="Default User", preferences={"theme": "system", "default_persona": "Default"})
    db.add(user)

    provider_map = {}
    for p in DEFAULT_PROVIDERS:
        provider = Provider(id=uuid.uuid4(), name=p["name"], display_name=p["display_name"], api_base_url=p["api_base_url"], auth_type=p["auth_type"], is_active=p["is_active"])
        db.add(provider)
        provider_map[p["id"]] = provider.id

    await db.flush()

    model_map = {}
    for m in DEFAULT_MODELS:
        caps = dict(m.get("capabilities") or {})
        if caps.get("chat") or caps.get("completion"):
            caps.setdefault("tools", True)
            caps.setdefault("function_calling", True)
        model = Model(id=uuid.uuid4(), provider_id=provider_map[m["provider_id"]], model_id=m["model_id"], display_name=m["display_name"], cost_per_1m_input=m["cost_per_1m_input"], cost_per_1m_output=m["cost_per_1m_output"], context_window=m["context_window"], capabilities=caps, is_active=True)
        db.add(model)
        model_map[m["model_id"]] = model.id

    await db.flush()

    for p in DEFAULT_PERSONAS:
        primary_model_id = model_map.get(p.get("primary_model"))
        persona = Persona(id=uuid.uuid4(), name=p["name"], description=p["description"], system_prompt=p["system_prompt"], primary_model_id=primary_model_id, memory_enabled=p["memory_enabled"], max_memory_messages=p["max_memory_messages"], is_default=p["is_default"])
        db.add(persona)

    for a in DEFAULT_AGENTS:
        agent = Agent(id=uuid.uuid4(), name=a["name"], agent_type=a["agent_type"], description=a.get("description", ""), system_prompt=a["system_prompt"], tools=a.get("tools", []), max_iterations=a.get("max_iterations", 10), timeout_seconds=a.get("timeout_seconds", 300), is_active=True)
        db.add(agent)

    await db.commit()
    logger.info(f"Seeded {len(DEFAULT_PROVIDERS)} providers, {len(DEFAULT_MODELS)} models, {len(DEFAULT_PERSONAS)} personas, {len(DEFAULT_AGENTS)} agents")
