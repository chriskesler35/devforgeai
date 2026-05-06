"""Alembic environment configuration."""

import os
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy import engine_from_config
from alembic import context
from app.models import Base

config = context.config
# Determine DB URL: prefer DATABASE_URL env var, fall back to PostgreSQL default.
# For local SQLite development, set DATABASE_URL=sqlite:///./modelmesh.db
_raw_db_url = os.environ.get("DATABASE_URL")
if not _raw_db_url:
    db_password = os.environ.get("POSTGRES_PASSWORD", "modelmesh_local_dev")
    _raw_db_url = f"postgresql://modelmesh:{db_password}@postgres:5432/modelmesh"
# Alembic requires a sync driver; convert async SQLite/PostgreSQL URLs
_db_url = _raw_db_url.replace("sqlite+aiosqlite", "sqlite").replace("postgresql+asyncpg", "postgresql")
config.set_main_option("sqlalchemy.url", _db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()