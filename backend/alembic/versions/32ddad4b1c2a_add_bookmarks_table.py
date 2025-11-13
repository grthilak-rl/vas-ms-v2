"""add_bookmarks_table

Revision ID: 32ddad4b1c2a
Revises: 031b56db3092
Create Date: 2025-11-12 15:41:07.068576

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '32ddad4b1c2a'
down_revision: Union[str, None] = '031b56db3092'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create bookmarks table
    op.create_table(
        'bookmarks',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('device_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('center_timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('start_timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('video_file_path', sa.String(512), nullable=False),
        sa.Column('thumbnail_path', sa.String(512), nullable=True),
        sa.Column('label', sa.String(255), nullable=True),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('duration', sa.Integer(), default=6),
        sa.Column('video_format', sa.String(10), default='mp4'),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
        sa.ForeignKeyConstraint(['device_id'], ['devices.id'], name='fk_bookmarks_device_id'),
    )

    # Create indexes for better query performance
    op.create_index('ix_bookmarks_device_id', 'bookmarks', ['device_id'])
    op.create_index('ix_bookmarks_center_timestamp', 'bookmarks', ['center_timestamp'])
    op.create_index('ix_bookmarks_source', 'bookmarks', ['source'])
    op.create_index('ix_bookmarks_created_at', 'bookmarks', ['created_at'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_bookmarks_created_at', table_name='bookmarks')
    op.drop_index('ix_bookmarks_source', table_name='bookmarks')
    op.drop_index('ix_bookmarks_center_timestamp', table_name='bookmarks')
    op.drop_index('ix_bookmarks_device_id', table_name='bookmarks')

    # Drop bookmarks table
    op.drop_table('bookmarks')


