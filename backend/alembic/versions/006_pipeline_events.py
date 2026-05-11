"""Add workbench_pipeline_events table for persisted SSE event logs.

Revision ID: 006_pipeline_events
Revises: 001_add_verification_tables
Create Date: 2026-05-11

Before this migration, pipeline SSE event logs lived only in the
``_event_logs`` in-memory dict in ``backend/app/routes/pipelines.py``.
A backend restart would erase every event, so the UI could no longer
replay history and the frontend would sit forever showing a "running"
pipeline with no events — the classic "zombie" symptom.

This migration adds ``workbench_pipeline_events`` so events survive
restarts and can be replayed during SSE reconnection.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '006_pipeline_events'
down_revision: Union[str, None] = '001_add_verification_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'workbench_pipeline_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column(
            'pipeline_id',
            sa.String(36),
            sa.ForeignKey('workbench_pipelines.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('seq', sa.Integer, nullable=False),
        sa.Column('event_type', sa.String(60), nullable=False),
        sa.Column('payload', sa.JSON, nullable=True),
        sa.Column('ts', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        'ix_workbench_pipeline_events_pipeline_id',
        'workbench_pipeline_events',
        ['pipeline_id'],
    )
    op.create_index(
        'ix_workbench_pipeline_events_pipeline_seq',
        'workbench_pipeline_events',
        ['pipeline_id', 'seq'],
    )


def downgrade() -> None:
    op.drop_index('ix_workbench_pipeline_events_pipeline_seq', table_name='workbench_pipeline_events')
    op.drop_index('ix_workbench_pipeline_events_pipeline_id', table_name='workbench_pipeline_events')
    op.drop_table('workbench_pipeline_events')
