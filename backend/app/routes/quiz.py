import json
from uuid import UUID
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models import User, Conversation, QuizSession, Message, MessageRole
from app.deps import get_current_user, decode_token_from_query
from app.llm import generate_mcq_batch, generate_report

router = APIRouter(prefix="/quiz", tags=["quiz"])

ALLOWED_SIZES = {5, 10, 20}
BATCH_SIZE = 5


class QuizGenerateIn(BaseModel):
    conversation_id: UUID
    size: int = Field(default=10)


class QuizMcqOut(BaseModel):
    question: str
    options: List[str]
    topic: str


class QuizSessionOut(BaseModel):
    id: UUID
    conversation_id: UUID
    total_questions: int
    questions: List[QuizMcqOut]
    submitted: bool
    created_at: datetime


class QuizSubmitIn(BaseModel):
    answers: List[int]


class QuizReportOut(BaseModel):
    id: UUID
    conversation_id: UUID
    total_questions: int
    correct_count: int
    submitted_at: datetime
    report: dict
    per_question: List[dict]


def _get_user_convo(db: Session, convo_id: UUID, user: User) -> Conversation:
    convo = (
        db.query(Conversation)
        .filter(Conversation.id == convo_id, Conversation.user_id == user.id)
        .first()
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo


def _get_user_session(db: Session, session_id: UUID, user: User) -> QuizSession:
    qs = (
        db.query(QuizSession)
        .filter(QuizSession.id == session_id, QuizSession.user_id == user.id)
        .first()
    )
    if not qs:
        raise HTTPException(status_code=404, detail="Quiz session not found")
    return qs


@router.get("/stream")
def stream_quiz_generation(
    conversation_id: UUID,
    size: int,
    token: str,
):
    """
    SSE stream — generates MCQs in batches of 5 for speed.
    Auth via ?token=... query param because EventSource can't set headers.
    """
    if size not in ALLOWED_SIZES:
        raise HTTPException(status_code=400, detail=f"size must be one of {sorted(ALLOWED_SIZES)}")

    user = decode_token_from_query(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    # validate + gather source + past quiz questions BEFORE streaming
    with SessionLocal() as db:
        u = db.query(User).filter(User.id == user.id).first()
        convo = _get_user_convo(db, conversation_id, u)
        if not convo.materials:
            raise HTTPException(status_code=400, detail="No documents attached")
        source = "\n\n".join(f"=== {m.title} ===\n{m.source_text}" for m in convo.materials)
        if len(source.strip()) < 200:
            raise HTTPException(status_code=400, detail="Not enough material to quiz on")

        past_quizzes = (
            db.query(QuizSession)
            .filter(
                QuizSession.user_id == user.id,
                QuizSession.conversation_id == conversation_id,
            )
            .all()
        )
        past_questions = []
        for pq in past_quizzes:
            for q in pq.questions:
                past_questions.append(q.get("question", ""))

    def event_stream():
        try:
            all_mcqs = []
            previous = list(past_questions)
            remaining = size
            batch_num = 0
            total_batches = (size + BATCH_SIZE - 1) // BATCH_SIZE

            while remaining > 0:
                this_batch = min(BATCH_SIZE, remaining)
                batch_num += 1

                yield (
                    f"event: progress\n"
                    f"data: {json.dumps({'current': len(all_mcqs), 'total': size, 'phase': f'batch {batch_num} of {total_batches}…'})}\n\n"
                )

                try:
                    batch = generate_mcq_batch(source, n=this_batch, previous_questions=previous)
                except Exception as e:
                    yield f"event: error\ndata: {json.dumps({'message': f'Batch {batch_num} failed: {e}'})}\n\n"
                    if not all_mcqs:
                        return
                    break

                all_mcqs.extend(batch)
                previous.extend([m["question"] for m in batch])
                remaining -= len(batch)

                if len(batch) == 0:
                    break

                last_topic = batch[-1]["topic"]
                yield (
                    f"event: progress\n"
                    f"data: {json.dumps({'current': len(all_mcqs), 'total': size, 'topic': last_topic})}\n\n"
                )

            if not all_mcqs:
                yield f"event: error\ndata: {json.dumps({'message': 'Could not generate any questions'})}\n\n"
                return

            with SessionLocal() as db:
                qs = QuizSession(
                    user_id=user.id,
                    conversation_id=conversation_id,
                    total_questions=len(all_mcqs),
                    questions=all_mcqs,
                )
                db.add(qs)
                db.commit()
                db.refresh(qs)
                session_id = str(qs.id)

            yield f"event: done\ndata: {json.dumps({'session_id': session_id, 'count': len(all_mcqs)})}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{session_id}", response_model=QuizSessionOut)
def get_quiz(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    qs = _get_user_session(db, session_id, current_user)
    return QuizSessionOut(
        id=qs.id,
        conversation_id=qs.conversation_id,
        total_questions=qs.total_questions,
        questions=[QuizMcqOut(question=q["question"], options=q["options"], topic=q.get("topic", "general"))
                   for q in qs.questions],
        submitted=qs.submitted_at is not None,
        created_at=qs.created_at,
    )


@router.post("/{session_id}/submit", response_model=QuizReportOut)
def submit_quiz(
    session_id: UUID,
    payload: QuizSubmitIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    qs = _get_user_session(db, session_id, current_user)
    if qs.submitted_at is not None:
        raise HTTPException(status_code=400, detail="Already submitted")
    if len(payload.answers) != qs.total_questions:
        raise HTTPException(status_code=400, detail=f"Expected {qs.total_questions} answers")
    for a in payload.answers:
        if not (0 <= a <= 3):
            raise HTTPException(status_code=400, detail="Each answer must be 0..3")

    # score
    per_question = []
    correct_count = 0
    for q, selected in zip(qs.questions, payload.answers):
        is_correct = (selected == q["correct_option"])
        if is_correct:
            correct_count += 1
        per_question.append({
            "question": q["question"],
            "topic": q.get("topic", "general"),
            "options": q["options"],
            "selected": selected,
            "correct": q["correct_option"],
            "is_correct": is_correct,
        })

    qs.answers = payload.answers
    qs.correct_count = correct_count
    qs.submitted_at = datetime.now(timezone.utc)

    # Generate the report inline. generate_report is time-bounded and falls back
    # to a local summary, so this returns promptly and never hangs — no polling.
    source = "\n\n".join(f"=== {m.title} ===\n{m.source_text}" for m in qs.conversation.materials)
    report = generate_report(per_question, source_text=source)
    qs.report = report

    # one finished assistant message carrying the full report
    db.add(Message(
        conversation_id=qs.conversation_id,
        role=MessageRole.assistant,
        content=f"Quiz report — {correct_count}/{qs.total_questions} correct",
        is_mcq=False,
        mcq_payload={
            "type": "quiz_report",
            "quiz_session_id": str(qs.id),
            "correct_count": correct_count,
            "total_questions": qs.total_questions,
            "report": report,
        },
    ))
    qs.conversation.last_message_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(qs)

    return QuizReportOut(
        id=qs.id,
        conversation_id=qs.conversation_id,
        total_questions=qs.total_questions,
        correct_count=correct_count,
        submitted_at=qs.submitted_at,
        report=report,
        per_question=per_question,
    )


@router.get("/{session_id}/report", response_model=QuizReportOut)
def get_report(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    qs = _get_user_session(db, session_id, current_user)
    if qs.submitted_at is None:
        raise HTTPException(status_code=400, detail="Quiz not submitted yet")

    per_question = []
    for q, selected in zip(qs.questions, qs.answers):
        per_question.append({
            "question": q["question"],
            "topic": q.get("topic", "general"),
            "options": q["options"],
            "selected": selected,
            "correct": q["correct_option"],
            "is_correct": selected == q["correct_option"],
        })

    return QuizReportOut(
        id=qs.id,
        conversation_id=qs.conversation_id,
        total_questions=qs.total_questions,
        correct_count=qs.correct_count,
        submitted_at=qs.submitted_at,
        report=qs.report or {},
        per_question=per_question,
    )
