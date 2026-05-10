import json
import os

path = r"C:\users\chris\.openclaw\openclaw.json"

try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    data["agents"]["defaults"]["model"]["primary"] = "google/gemini-3.1-pro-preview"
    data["agents"]["defaults"]["model"]["fallbacks"] = [
        "anthropic/claude-sonnet-4-6",
        "ollama/qwen2.5-coder:14b",
        "ollama/llama3.1:8b"
    ]

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    
    print("Successfully updated openclaw.json")
except Exception as e:
    print(f"Error: {e}")
