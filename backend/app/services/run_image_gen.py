"""Image generation helper for Run chat.

Provides:
1. `generate_image_for_run()` — call image generation and store the result
   as an assistant message with image_url on the Run.
2. `IMAGE_TOOL_SCHEMA` — OpenAI-format tool definition for LLM tool-calling.
3. `handle_image_tool_call()` — process an LLM-generated image tool call.
"""

import logging
import os
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import run_events
from app.services.app_settings_helper import get_setting

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool schema for LLM function-calling
# ---------------------------------------------------------------------------

IMAGE_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "generate_image",
        "description": (
            "Generate an image from a text description. Use this when the user "
            "asks you to create, draw, design, illustrate, or generate an image, "
            "picture, photo, artwork, diagram, or visual. Do NOT use this for "
            "text-only requests."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": (
                        "A detailed description of the image to generate. "
                        "Be specific about style, composition, colors, and subjects."
                    ),
                },
                "size": {
                    "type": "string",
                    "enum": ["1024x1024", "1024x1536", "1536x1024"],
                    "description": "Image dimensions. Square by default.",
                },
            },
            "required": ["prompt"],
        },
    },
}


# ---------------------------------------------------------------------------
# Core generation helper
# ---------------------------------------------------------------------------

async def generate_image_for_run(
    db: AsyncSession,
    run_id: str,
    prompt: str,
    *,
    size: str = "1024x1024",
    provider: Optional[str] = None,
) -> dict:
    """Generate an image and store it as a Run message.

    Returns {"image_url": str, "image_id": str, "prompt": str} on success,
    or {"error": str} on failure.
    """
    from app.routes.images import (
        IMAGE_STORAGE,
        ImageGenerationRequest,
        generate_with_gemini_imagen,
        _store_image,
    )
    import uuid

    # Decide which provider to use
    if not provider:
        provider = await get_setting("default_image_provider", db) or "gemini"

    # Normalize provider name
    if provider in ("gemini", "gemini-imagen"):
        provider = "gemini-imagen"
    elif provider in ("comfyui", "comfyui-local", "local"):
        provider = "comfyui-local"

    # Emit a model_request event so the UI shows progress
    await run_events.emit(
        db, run_id, "model_request",
        summary=f"Generating image ({provider}): {prompt[:60]}",
        payload={"provider": provider, "prompt": prompt, "size": size},
    )
    await db.commit()

    try:
        if provider == "gemini-imagen":
            api_key = (
                os.environ.get("GEMINI_API_KEY")
                or os.environ.get("GOOGLE_API_KEY")
            )
            if not api_key:
                error_msg = "GEMINI_API_KEY not configured. Add it to your .env file."
                await run_events.record_message(
                    db, run_id, role="assistant",
                    content=f"⚠️ {error_msg}",
                )
                await db.commit()
                return {"error": error_msg}

            result = await generate_with_gemini_imagen(prompt, api_key, size)

        elif provider == "comfyui-local":
            from app.routes.images import generate_with_comfyui
            from app.routes.workflows import _get_running_comfyui_url

            comfyui_url = await _get_running_comfyui_url(db, timeout=2.5)
            comfyui_dir = await get_setting("comfyui_dir", db)

            if not comfyui_url:
                error_msg = "ComfyUI is not running. Start it from Settings > Image Generation."
                await run_events.record_message(
                    db, run_id, role="assistant",
                    content=f"⚠️ {error_msg}",
                )
                await db.commit()
                return {"error": error_msg}

            result = await generate_with_comfyui(
                prompt=prompt,
                comfyui_url=comfyui_url,
                comfyui_dir=comfyui_dir,
            )
        else:
            error_msg = f"Unknown image provider: {provider}"
            await run_events.record_message(
                db, run_id, role="assistant",
                content=f"⚠️ {error_msg}",
            )
            await db.commit()
            return {"error": error_msg}

        # Store the image
        image_id = str(uuid.uuid4())
        width, height = (int(d) for d in size.split("x"))
        image_data = {
            "base64": result["base64"],
            "prompt": prompt,
            "revised_prompt": result.get("revised_prompt"),
            "format": "png",
            "size": size,
            "model": provider,
        }
        _store_image(image_id, image_data)

        # The public URL the frontend can use in <img> tags
        image_url = f"/v1/img/{image_id}"

        # Store assistant message with image
        await run_events.record_message(
            db, run_id, role="assistant",
            content=f"Here's the generated image:\n\n{prompt}",
            image_url=image_url,
        )

        # Emit model_response event
        await run_events.emit(
            db, run_id, "model_response",
            summary=f"Image generated: {prompt[:80]}",
            payload={
                "provider": provider,
                "image_id": image_id,
                "image_url": image_url,
                "size": size,
            },
        )
        await db.commit()

        return {"image_url": image_url, "image_id": image_id, "prompt": prompt}

    except Exception as exc:
        error_msg = f"Image generation failed: {exc}"
        logger.warning("Image generation failed for run %s: %s", run_id, exc)
        await run_events.record_message(
            db, run_id, role="assistant",
            content=f"⚠️ {error_msg}",
        )
        await db.commit()
        return {"error": error_msg}


# ---------------------------------------------------------------------------
# Handle LLM tool call for image generation
# ---------------------------------------------------------------------------

async def handle_image_tool_call(
    db: AsyncSession,
    run_id: str,
    arguments: dict,
) -> str:
    """Process a generate_image tool call from the LLM.

    Returns a text summary for the LLM to incorporate into its response.
    """
    prompt = arguments.get("prompt", "")
    size = arguments.get("size", "1024x1024")

    if not prompt:
        return "Error: No prompt provided for image generation."

    result = await generate_image_for_run(db, run_id, prompt, size=size)

    if "error" in result:
        return f"Image generation failed: {result['error']}"

    return f"Image generated successfully. The image has been displayed to the user."
