"""Add projects and runs tables (Run as the polymorphic unit of work).

Revision ID: 007_runs_and_projects
Revises: 006_pipeline_events
Create Date: 2026-05-13

Introduces:
  - projects         (mirrors data/projects.json; Scratch row seeded)
  - runs             (the polymorphic Run)
  - run_phases       (method-driven phase tracking)
  - run_messages     (in-Run chat messages)
  - run_events       (full transparency timeline)

See docs/superpowers/specs/2026-05-12-the-run-design.md for the design.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '007_runs_and_projects'
down_revision: Union[str, None] = '006_pipeline_events'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- projects ---
    op.create_table(
        'projects',
        sa.Column('id',           sa.String(64),  primary_key=True),
        sa.Column('name',         sa.Text,        nullable=False),
        sa.Column('path',         sa.Text,        nullable=True),
        sa.Column('description',  sa.Text,        nullable=True),
        sa.Column('template',     sa.Text,        nullable=True),
        sa.Column('sandbox_mode', sa.String(20),  nullable=False, server_default='full'),
        sa.Column('is_system',    sa.Boolean,     nullable=False, server_default=sa.text('0')),
        sa.Column('is_active',    sa.Boolean,     nullable=False, server_default=sa.text('1')),
        sa.Column('extra_data',   sa.JSON,        nullable=True),
        sa.Column('created_at',   sa.DateTime,    nullable=True, server_default=sa.func.now()),
        sa.Column('updated_at',   sa.DateTime,    nullable=True, server_default=sa.func.now()),
    )

    # Seed Scratch project
    op.execute(
        sa.text(
            "INSERT INTO projects (id, name, sandbox_mode, is_system, is_active, description) "
            "VALUES ('scratch', 'Scratch', 'restricted', 1, 1, "
            "'Casual chat & ad-hoc Runs. No shell, no writes outside data/scratch/.')"
        )
    )

    # --- runs ---
    op.create_table(
        'runs',
        sa.Column('id',                   sa.String(36), primary_key=True),
        sa.Column('title',                sa.Text,       nullable=True),
        sa.Column('project_id',           sa.String(64), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('method_id',            sa.Text,       nullable=True),
        sa.Column('state',                sa.String(30), nullable=False, server_default='awaiting_input'),
        sa.Column('current_phase_id',     sa.String(36), nullable=True),
        sa.Column('forked_from_event_id', sa.String(36), nullable=True),
        sa.Column('power_tools_enabled',  sa.Boolean,    nullable=False, server_default=sa.text('0')),
        sa.Column('extra_data',           sa.JSON,       nullable=True),
        sa.Column('created_at',           sa.DateTime,   nullable=True, server_default=sa.func.now()),
        sa.Column('updated_at',           sa.DateTime,   nullable=True, server_default=sa.func.now()),
        sa.Column('completed_at',         sa.DateTime,   nullable=True),
    )
    op.create_index('ix_runs_project_id', 'runs', ['project_id'])
    op.create_index('ix_runs_state',      'runs', ['state'])

    # --- run_phases ---
    op.create_table(
        'run_phases',
        sa.Column('id',         sa.String(36),  primary_key=True),
        sa.Column('run_id',     sa.String(36),  sa.ForeignKey('runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('index',      sa.Integer,     nullable=False),
        sa.Column('name',       sa.Text,        nullable=False),
        sa.Column('agent_role', sa.Text,        nullable=True),
        sa.Column('model_id',   sa.String(200), nullable=True),
        sa.Column('status',     sa.String(20),  nullable=False, server_default='queued'),
        sa.Column('started_at', sa.DateTime,    nullable=True),
        sa.Column('ended_at',   sa.DateTime,    nullable=True),
        sa.UniqueConstraint('run_id', 'index', name='uq_run_phase_index'),
    )
    op.create_index('ix_run_phases_run_id', 'run_phases', ['run_id'])

    # --- run_messages ---
    op.create_table(
        'run_messages',
        sa.Column('id',         sa.String(36), primary_key=True),
        sa.Column('run_id',     sa.String(36), sa.ForeignKey('runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role',       sa.String(20), nullable=False),
        sa.Column('content',    sa.Text,       nullable=False),
        sa.Column('image_url',  sa.Text,       nullable=True),
        sa.Column('created_at', sa.DateTime,   nullable=True, server_default=sa.func.now()),
    )
    op.create_index('ix_run_messages_run_created', 'run_messages', ['run_id', 'created_at'])

    # --- run_events ---
    op.create_table(
        'run_events',
        sa.Column('id',          sa.String(36), primary_key=True),
        sa.Column('run_id',      sa.String(36), sa.ForeignKey('runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('phase_id',    sa.String(36), sa.ForeignKey('run_phases.id', ondelete='SET NULL'), nullable=True),
        sa.Column('kind',        sa.String(40), nullable=False),
        sa.Column('summary',     sa.Text,       nullable=False),
        sa.Column('payload',     sa.JSON,       nullable=False),
        sa.Column('duration_ms', sa.Integer,    nullable=True),
        sa.Column('tokens_in',   sa.Integer,    nullable=True),
        sa.Column('tokens_out',  sa.Integer,    nullable=True),
        sa.Column('cost_usd',    sa.Numeric(10, 4), nullable=True),
        sa.Column('created_at',  sa.DateTime,   nullable=True, server_default=sa.func.now()),
    )
    op.create_index('ix_run_events_run_created', 'run_events', ['run_id', 'created_at'])
    op.create_index('ix_run_events_run_phase',   'run_events', ['run_id', 'phase_id'])

    # Deferred FKs: runs.current_phase_id → run_phases.id,
    #               runs.forked_from_event_id → run_events.id
    # SQLite doesn't enforce ADD CONSTRAINT after table creation,
    # so these are documented here but enforced at the ORM/service layer.


def downgrade() -> None:
    op.drop_index('ix_run_events_run_phase',     table_name='run_events')
    op.drop_index('ix_run_events_run_created',   table_name='run_events')
    op.drop_table('run_events')

    op.drop_index('ix_run_messages_run_created',  table_name='run_messages')
    op.drop_table('run_messages')

    op.drop_index('ix_run_phases_run_id',          table_name='run_phases')
    op.drop_table('run_phases')

    op.drop_index('ix_runs_state',     table_name='runs')
    op.drop_index('ix_runs_project_id', table_name='runs')
    op.drop_table('runs')

    op.drop_table('projects')
