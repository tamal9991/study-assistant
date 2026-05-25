from uuid import UUID
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Material, Conversation, Message, McqAttempt, MessageRole
from app.deps import get_current_user
from app.llm import answer_question, generate_mcq

router = APIRouter(prefix="/chat", tags=["chat"])


class ConversationCreate(BaseModel):
    title: Optional[str] = None


class MaterialMini(BaseModel):
    id: UUID
    title: str
    file_type: str
    char_count: int

    class Config:
        from_attributes = True
        use_enum_values = True


class ConversationOut(BaseModel):
    id: UUID
    title: str
    last_message_at: Optional[datetime]
    created_at: datetime
    materials: List[MaterialMini] = []

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    is_mcq: bool
    mcq_payload: Optional[dict] = None
    user_selected: Optional[int] = None
    is_correct: Optional[bool] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SendMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    mode: str = Field(default="chat", pattern=r"^(chat|quiz)$")


class EditMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class AnswerMcqIn(BaseModel):
    selected_option: int = Field(ge=0, le=3)


class AttachMaterialIn(BaseModel):
    material_id: UUID


def _get_user_conversation(db: Session, convo_id: UUID, user: User) -> Conversation:
    convo = (
        db.query(Conversation)
        .filter(Conversation.id == convo_id, Conversation.user_id == user.id)
        .first()
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo


def _combined_source(convo: Conversation) -> str:
    if not convo.materials:
        return ""
    parts = []
    for mat in convo.materials:
        parts.append(f"=== {mat.title} ===\n{mat.source_text}")
    return "\n\n".join(parts)


def _serialize_message(msg: Message) -> MessageOut:
    attempt = msg.mcq_attempt
    role_value = msg.role.value if hasattr(msg.role, 'value') else msg.role
    return MessageOut(
        id=msg.id,
        role=role_value,
        content=msg.content,
        is_mcq=msg.is_mcq,
        mcq_payload=msg.mcq_payload,
        user_selected=attempt.selected_option if attempt else None,
        is_correct=attempt.is_correct if attempt else None,
        created_at=msg.created_at,
    )


@router.post("/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = Conversation(
        user_id=current_user.id,
        title=(payload.title or "New chat")[:255],
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo


@router.get("/conversations", response_model=List[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.last_message_at.desc().nulls_last(), Conversation.created_at.desc())
        .all()
    )


@router.get("/conversations/{convo_id}", response_model=ConversationOut)
def get_conversation(
    convo_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_user_conversation(db, convo_id, current_user)


@router.post("/conversations/{convo_id}/materials", response_model=ConversationOut)
def attach_material(
    convo_id: UUID,
    payload: AttachMaterialIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = _get_user_conversation(db, convo_id, current_user)
    material = (
        db.query(Material)
        .filter(Material.id == payload.material_id, Material.user_id == current_user.id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    if material not in convo.materials:
        convo.materials.append(material)
        db.commit()
        db.refresh(convo)
    return convo


@router.delete("/conversations/{convo_id}/materials/{material_id}", response_model=ConversationOut)
def detach_material(
    convo_id: UUID,
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = _get_user_conversation(db, convo_id, current_user)
    material = next((m for m in convo.materials if m.id == material_id), None)
    if not material:
        raise HTTPException(status_code=404, detail="Material not in this conversation")
    convo.materials.remove(material)
    db.commit()
    db.refresh(convo)
    return convo


@router.get("/conversations/{convo_id}/messages", response_model=List[MessageOut])
def list_messages(
    convo_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = _get_user_conversation(db, convo_id, current_user)
    return [_serialize_message(m) for m in convo.messages]


@router.post("/conversations/{convo_id}/messages", response_model=List[MessageOut])
def send_message(
    convo_id: UUID,
    payload: SendMessageIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = _get_user_conversation(db, convo_id, current_user)
    if not convo.materials:
        raise HTTPException(status_code=400, detail="Attach at least one document first")

    source = _combined_source(convo)

    user_msg = Message(
        conversation_id=convo.id,
        role=MessageRole.user,
        content=payload.content,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user_msg)
    db.flush()

    history = []
    for m in convo.messages:
        if m.id == user_msg.id:
            continue
        if m.is_mcq:
            history.append({"role": "assistant", "content": f"[MCQ: {m.mcq_payload.get('question', '')}]"})
        else:
            role_value = m.role.value if hasattr(m.role, 'value') else m.role
            history.append({"role": role_value, "content": m.content})

    if payload.mode == "quiz":
        previous_questions = [
            m.mcq_payload["question"]
            for m in convo.messages
            if m.is_mcq and m.mcq_payload
        ]
        try:
            mcq = generate_mcq(source, previous_questions)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"MCQ generation failed: {e}")
        assistant_msg = Message(
            conversation_id=convo.id,
            role=MessageRole.assistant,
            content=mcq["question"],
            is_mcq=True,
            mcq_payload=mcq,
            created_at=datetime.now(timezone.utc),
        )
    else:
        try:
            reply = answer_question(source, history, payload.content)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

        assistant_msg = Message(
            conversation_id=convo.id,
            role=MessageRole.assistant,
            content=reply,
            is_mcq=False,
            created_at=datetime.now(timezone.utc),
        )

    db.add(assistant_msg)
    convo.last_message_at = datetime.now(timezone.utc)

    if convo.title == "New chat":
        convo.title = payload.content[:60]

    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)
    return [_serialize_message(user_msg), _serialize_message(assistant_msg)]


@router.post("/messages/{message_id}/answer", response_model=MessageOut)
def answer_mcq(
    message_id: UUID,
    payload: AnswerMcqIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    msg = (
        db.query(Message)
        .join(Conversation)
        .filter(Message.id == message_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if not msg.is_mcq:
        raise HTTPException(status_code=400, detail="Message is not an MCQ")
    if msg.mcq_attempt:
        raise HTTPException(status_code=400, detail="MCQ already answered")

    correct = msg.mcq_payload["correct_option"]
    attempt = McqAttempt(
        message_id=msg.id,
        selected_option=payload.selected_option,
        correct_option=correct,
        is_correct=(payload.selected_option == correct),
    )
    db.add(attempt)
    db.commit()
    db.refresh(msg)
    return _serialize_message(msg)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=255)


@router.patch("/conversations/{convo_id}", response_model=ConversationOut)
def rename_conversation(
    convo_id: UUID,
    payload: ConversationRename,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = _get_user_conversation(db, convo_id, current_user)
    convo.title = payload.title.strip()
    db.commit()
    db.refresh(convo)
    return convo


@router.delete("/conversations/{convo_id}", status_code=204)
def delete_conversation(
    convo_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convo = _get_user_conversation(db, convo_id, current_user)
    # messages cascade via the ORM relationship; quiz_sessions and
    # conversation_materials cascade at the DB level (ondelete=CASCADE).
    db.delete(convo)
    db.commit()


@router.post("/conversations/{convo_id}/messages/{message_id}/edit", response_model=List[MessageOut])
def edit_message(
    convo_id: UUID,
    message_id: UUID,
    payload: EditMessageIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit a user message: drop it and everything after it, then re-run the
    turn with the new content (like editing a prompt in a chat app)."""
    convo = _get_user_conversation(db, convo_id, current_user)
    target = (
        db.query(Message)
        .filter(Message.id == message_id, Message.conversation_id == convo.id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Message not found")

    role_value = target.role.value if hasattr(target.role, "value") else target.role
    if role_value != "user":
        raise HTTPException(status_code=400, detail="You can only edit your own messages")

    # convo.messages is ordered (created_at, role); delete from the target onward
    ordered = list(convo.messages)
    start = next((i for i, m in enumerate(ordered) if m.id == target.id), None)
    for m in ordered[start:]:
        db.delete(m)
    db.commit()

    # regenerate by sending the edited content as a fresh chat turn
    return send_message(convo_id, SendMessageIn(content=payload.content, mode="chat"), db, current_user)