#!/usr/bin/env python3
"""DevForgeAI command-line interface.

Usage:
    devforgeai plugins install [provider]
    devforgeai plugins list
    devforgeai plugins health [provider]
    devforgeai plugins verify [provider]
    devforgeai plugins configure [provider]
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.cli.plugins import cli

if __name__ == "__main__":
    cli()
