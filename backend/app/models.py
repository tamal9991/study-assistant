import uuid
import enum
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Boolean,
    Enum, Index, CheckConstraint, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, validates
from app.database import Base


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"

class FileType(str, enum.Enum):
    pdf = "pdf"
    image = "image"
    docx = "docx"
    text = "text"


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    username = Column(String(50), unique=True, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    materials = relationship("Material", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)

    __table_args__ = (
        CheckConstraint("char_length(email) >= 3", name="ck_users_email_min_length"),
        CheckConstraint("char_length(name) >= 1", name="ck_users_name_not_empty"),
        CheckConstraint("char_length(username) >= 2", name="ck_users_username_min_length"),
    )

    @validates("email")
    def normalize_email(self, key, value):
        return value.strip().lower()


class Material(Base, TimestampMixin):
    __tablename__ = "materials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    source_text = Column(Text, nullable=False)
    file_type = Column(Enum(FileType, name="file_type"), nullable=False, default=FileType.text)
    page_count = Column(Integer, nullable=True)
    char_count = Column(Integer, nullable=False, default=0)

    user = relationship("User", back_populates="materials")
    conversations = relationship(
        "Conversation",
        secondary="conversation_materials",
        back_populates="materials",
    )

    __table_args__ = (
        Index("ix_materials_user_id_created_at", "user_id", "created_at"),
        CheckConstraint("char_length(title) >= 1", name="ck_materials_title_not_empty"),
        CheckConstraint("char_count >= 0", name="ck_materials_char_count_non_negative"),
    )


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False, default="New chat")
    last_message_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="conversations")
    materials = relationship(
        "Material",
        secondary="conversation_materials",
        back_populates="conversations",
    )
    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        # Secondary sort on role breaks ties when a user message and its
        # assistant reply share a timestamp (e.g. legacy rows created in the
        # same transaction). The message_role enum is declared user < assistant,
        # so the user message always sorts first.
        order_by="Message.created_at, Message.role",
    )

    __table_args__ = (
        Index("ix_conversations_user_last_message", "user_id", "last_message_at"),
    )


class ConversationMaterial(Base):
    __tablename__ = "conversation_materials"

    conversation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    material_id = Column(
        UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        primary_key=True,
    )
    added_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class McqAttempt(Base, TimestampMixin):
    __tablename__ = "mcq_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    selected_option = Column(Integer, nullable=False)
    correct_option = Column(Integer, nullable=False)
    is_correct = Column(Boolean, nullable=False)

    message = relationship("Message", back_populates="mcq_attempt")

    __table_args__ = (
        UniqueConstraint("message_id", name="uq_mcq_attempts_message_id"),
        CheckConstraint("selected_option >= 0", name="ck_mcq_selected_non_negative"),
        CheckConstraint("correct_option >= 0", name="ck_mcq_correct_non_negative"),
    )

class Message(Base, TimestampMixin):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(Enum(MessageRole, name="message_role"), nullable=False)
    content = Column(Text, nullable=False)
    is_mcq = Column(Boolean, nullable=False, default=False)
    mcq_payload = Column(JSONB, nullable=True)

    conversation = relationship("Conversation", back_populates="messages")
    mcq_attempt = relationship("McqAttempt", back_populates="message", uselist=False, cascade="all, delete-orphan", passive_deletes=True)

    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
        CheckConstraint(
            "(is_mcq = false) OR (mcq_payload IS NOT NULL)",
            name="ck_messages_mcq_has_payload",
        ),
    )



class QuizSession(Base, TimestampMixin):
    __tablename__ = "quiz_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    total_questions = Column(Integer, nullable=False)
    correct_count = Column(Integer, nullable=True)
    questions = Column(JSONB, nullable=False)
    answers = Column(JSONB, nullable=True)
    report = Column(JSONB, nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)

    conversation = relationship("Conversation")

    __table_args__ = (
        Index("ix_quiz_sessions_user", "user_id", "created_at"),
    )