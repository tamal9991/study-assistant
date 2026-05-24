"""add file_type to materials

Revision ID: 45037920c816
Revises: 41a7404d2f3f
Create Date: 2026-05-23 08:06:04.474933

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45037920c816'
down_revision: Union[str, None] = '41a7404d2f3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. create the enum type first
    file_type_enum = sa.Enum('pdf', 'image', 'docx', 'text', name='file_type')
    file_type_enum.create(op.get_bind(), checkfirst=True)

    # 2. add column as nullable
    op.add_column('materials', sa.Column('file_type', file_type_enum, nullable=True))

    # 3. backfill existing rows with default 'text'
    op.execute("UPDATE materials SET file_type = 'text' WHERE file_type IS NULL")

    # 4. now enforce NOT NULL
    op.alter_column('materials', 'file_type', nullable=False)


def downgrade() -> None:
    op.drop_column('materials', 'file_type')
    sa.Enum(name='file_type').drop(op.get_bind(), checkfirst=True)