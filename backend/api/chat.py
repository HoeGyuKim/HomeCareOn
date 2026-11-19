"""거주자 접수 대화 API (전화 대신 웹 마이크)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DB

from ..engine import engine
from ..engine.session import STEP, Session
from .deps import get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])

LIABILITY_KEYS = ("payer", "tenant_cost_possible", "needs_review", "item_id", "item_label", "item_path",
                  "landlord_text", "tenant_text", "reason", "source")


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class TurnOut(BaseModel):
    session_id: str
    reply: str
    state: str
    step: int
    slots: dict
    equipment: str | None
    error_meaning: str | None
    liability: dict | None
    outcome: str | None
    ticket_id: int | None
    nlu_source: str | None


def _sessions(request: Request) -> dict[str, Session]:
    return request.app.state.sessions


def _out(s: Session, reply: str) -> TurnOut:
    return TurnOut(
        session_id=s.id,
        reply=reply,
        state=s.state.value,
        step=STEP[s.state],
        slots=s.slots,
        equipment=s.equipment,
        error_meaning=s.error_meaning,
        liability={k: s.liability.get(k) for k in LIABILITY_KEYS} if s.liability else None,
        outcome=s.outcome,
        ticket_id=s.ticket_id,
        nlu_source=s.last_nlu,
    )


@router.post("/sessions", response_model=TurnOut)
def create_session(request: Request) -> TurnOut:
    s = engine.start(uuid.uuid4().hex)
    _sessions(request)[s.id] = s
    return _out(s, engine.GREETING)


@router.post("/sessions/{session_id}/messages", response_model=TurnOut)
def send_message(session_id: str, body: MessageIn, request: Request, db: DB = Depends(get_db)) -> TurnOut:
    s = _sessions(request).get(session_id)
    if s is None:
        raise HTTPException(404, "세션이 없습니다. 새로 접수를 시작해 주세요.")
    reply = engine.handle_turn(db, s, body.text)
    return _out(s, reply)
