"""Add model verification and provider health tables.

Revision ID: add_verification_tables
Revises: 
Create Date: 2026-05-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_verification_tables'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create model_verifications table
    op.create_table(
        'model_verifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('model_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('verification_status', sa.String(20), nullable=False, server_default='unverified'),
        sa.Column('verified_at', sa.DateTime(), nullable=True),
        sa.Column('verified_by', sa.String(100), nullable=True),
        sa.Column('test_results', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('capabilities', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('fallback_recommendations', sa.Text(), nullable=True),
        sa.Column('last_verified_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['model_id'], ['models.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('model_id', name='uq_model_verifications_model_id'),
        sa.CheckConstraint(
            "verification_status IN ('unverified', 'pending', 'verified', 'failed', 'degraded')",
            name='check_verification_status'
        ),
    )
    op.create_index('idx_model_verifications_status', 'model_verifications', ['verification_status'])
    op.create_index('idx_model_verifications_verified_at', 'model_verifications', ['verified_at'], postgresql_ops={'verified_at': 'DESC'})

    # Create provider_health table
    op.create_table(
        'provider_health',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('provider_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('health_status', sa.String(20), nullable=False, server_default='unknown'),
        sa.Column('last_checked_at', sa.DateTime(), nullable=True),
        sa.Column('last_check_duration_ms', sa.Integer(), nullable=True),
        sa.Column('credential_status', sa.String(20), nullable=True, server_default='unchecked'),
        sa.Column('credential_last_checked_at', sa.DateTime(), nullable=True),
        sa.Column('credential_error_message', sa.Text(), nullable=True),
        sa.Column('connectivity_status', sa.String(20), nullable=True, server_default='unchecked'),
        sa.Column('connectivity_last_checked_at', sa.DateTime(), nullable=True),
        sa.Column('connectivity_error_message', sa.Text(), nullable=True),
        sa.Column('rate_limit_remaining', sa.Integer(), nullable=True),
        sa.Column('rate_limit_reset_at', sa.DateTime(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('provider_id', name='uq_provider_health_provider_id'),
        sa.CheckConstraint(
            "health_status IN ('ok', 'degraded', 'failed', 'unknown')",
            name='check_health_status'
        ),
        sa.CheckConstraint(
            "credential_status IN ('valid', 'invalid', 'unchecked')",
            name='check_credential_status'
        ),
        sa.CheckConstraint(
            "connectivity_status IN ('ok', 'error', 'unchecked')",
            name='check_connectivity_status'
        ),
    )
    op.create_index('idx_provider_health_status', 'provider_health', ['health_status'])
    op.create_index('idx_provider_health_last_checked', 'provider_health', ['last_checked_at'], postgresql_ops={'last_checked_at': 'DESC'})

    # Add columns to models table
    op.add_column('models', sa.Column('is_pinned_default', sa.Boolean(), nullable=True, server_default='false'))
    op.add_column('models', sa.Column('fallback_priority', sa.Integer(), nullable=True, server_default='999'))
    op.create_index('idx_models_fallback_priority', 'models', ['fallback_priority'])


def downgrade():
    op.drop_index('idx_models_fallback_priority', table_name='models')
    op.drop_column('models', 'fallback_priority')
    op.drop_column('models', 'is_pinned_default')
    
    op.drop_index('idx_provider_health_last_checked', table_name='provider_health')
    op.drop_index('idx_provider_health_status', table_name='provider_health')
    op.drop_table('provider_health')
    
    op.drop_index('idx_model_verifications_verified_at', table_name='model_verifications')
    op.drop_index('idx_model_verifications_status', table_name='model_verifications')
    op.drop_table('model_verifications')
