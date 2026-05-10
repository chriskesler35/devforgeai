"""Raise max_cost for coding-focused personas to reduce false cost-limit blocks.

Usage:
  python -m app.scripts.raise_coding_persona_limits
  python -m app.scripts.raise_coding_persona_limits --max-cost 0.35 --dry-run
"""

import argparse
import asyncio
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.database import AsyncSessionLocal
from app.models import Persona


DEFAULT_MAX_COST = 0.30

# Name-based targeting keeps this safe and explicit for coding-focused roles.
CODING_NAME_KEYWORDS = (
    "coder",
    "coding",
    "engineer",
    "developer",
    "implementation",
    "architect",
    "qa",
    "validator",
    "release",
)


def _is_coding_persona(name: str) -> bool:
    lowered = (name or "").lower()
    return any(keyword in lowered for keyword in CODING_NAME_KEYWORDS)


async def apply(max_cost: float, dry_run: bool = False) -> int:
    updated = 0
    async with AsyncSessionLocal() as session:
        personas = (await session.execute(select(Persona))).scalars().all()

        for persona in personas:
            if not _is_coding_persona(persona.name):
                continue

            rules = dict(persona.routing_rules or {})
            current = rules.get("max_cost")

            # Raise only when unset or lower than desired target.
            if current is None or float(current) < float(max_cost):
                rules["max_cost"] = float(max_cost)
                persona.routing_rules = rules
                # routing_rules is a JSON column; force dirty tracking for reliability.
                flag_modified(persona, "routing_rules")
                persona.updated_at = datetime.utcnow()
                updated += 1
                print(
                    f"UPDATE {persona.name}: max_cost {current} -> {max_cost}"
                )

        if dry_run:
            await session.rollback()
            print(f"DRY RUN complete. Would update {updated} persona(s).")
        else:
            await session.commit()
            print(f"Applied updates to {updated} persona(s).")

    return updated


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-cost", type=float, default=DEFAULT_MAX_COST)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(apply(max_cost=args.max_cost, dry_run=args.dry_run))
