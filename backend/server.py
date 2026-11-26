"""HomeCareOn 대화 엔진 API 서버 (FastAPI).

관리자·거주자 웹(frontend/defect-care)의 'AI 전화 접수'가 이 서버를 부른다.
실제 전화 연동 시에도 STT 결과 텍스트를 같은 API로 보내고, 응답 문장을 TTS로 읽으면 된다.

    .venv\\Scripts\\python -m uvicorn backend.server:app --port 8100

- POST /api/dialogue/sessions                 새 통화 시작 → 첫 인사
- POST /api/dialogue/sessions/{id}/messages   거주자 발화 {text} → 상담원 응답
- GET  /api/dialogue/sessions/{id}            통화 상태
- GET  /api/rag/search?q=...                  수선유지 RAG 검색 (확인용)
- POST /api/rag/decide                        비용 부담 판정 (확인용)
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend import rag
from backend.dialogue.llm_client import llm_status, load_api_key
from backend.dialogue.orchestrator import DialogueOrchestrator
from backend.dialogue.state import DialogueState

app = FastAPI(title="HomeCareOn 대화 엔진", version="0.1.0")

SESSION_TTL = 2 * 60 * 60
_sessions: Dict[str, tuple[float, DialogueOrchestrator]] = {}

# 웹 화면이 "지금 무엇을 기다리는지" 표시할 때 쓰는 값 (defect-care 의 Awaiting 과 맞춤)
AWAITING = {
    DialogueState.INIT: "dongho",
    DialogueState.IDENTIFY_RESIDENT: "dongho",
    DialogueState.ASK_FACILITY: "issue",
    DialogueState.PROBE_CAUSE: "cause",
    DialogueState.ADVISE_COST: "confirm",
    DialogueState.TICKET_ISSUED: "done",
    DialogueState.CLOSED: "done",
}


def _view(session_id: str, orc: DialogueOrchestrator, reply: str) -> Dict[str, Any]:
    s = orc.session
    awaiting = AWAITING[orc.state]
    if orc.state == DialogueState.IDENTIFY_RESIDENT and s.building and s.unit and not s.resident_name:
        awaiting = "name"
    return {
        "session_id": session_id,
        # Gemini가 실패 후 쉬는 중이면 실제로는 규칙 모드로 답하므로 화면에도 그렇게 표시
        "engine": "gemini" if orc.use_llm and llm_status()["available"] else "rules",
        "state": orc.state.value,
        "awaiting": awaiting,
        "reply": reply,
        "session": s.model_dump(),
    }


def _get(session_id: str) -> DialogueOrchestrator:
    now = time.time()
    for sid, (t, _) in list(_sessions.items()):
        if now - t > SESSION_TTL:
            _sessions.pop(sid, None)
    if session_id not in _sessions:
        raise HTTPException(404, "통화가 종료되었거나 만료되었습니다. 새 통화를 시작하세요.")
    _, orc = _sessions[session_id]
    _sessions[session_id] = (now, orc)
    return orc


class Utterance(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


class DecideRequest(BaseModel):
    item_id: str
    cause: str = ""
    symptom: str = ""
    move_in_date: Optional[str] = None


@app.get("/", include_in_schema=False)
def root():
    # 이 서버는 화면이 없는 API 서버라, 주소창으로 열면 API 문서로 보낸다 (접수 화면은 관리자 웹 :3000)
    return RedirectResponse("/docs")


@app.get("/api/health")
def health():
    return {"ok": True, "llm": bool(load_api_key()), "gemini": llm_status(), "items": len(rag.load_items())}


@app.post("/api/dialogue/sessions")
def start_session():
    orc = DialogueOrchestrator(use_llm=bool(load_api_key()))
    sid = uuid.uuid4().hex
    _sessions[sid] = (time.time(), orc)
    return _view(sid, orc, orc.start_call())


@app.post("/api/dialogue/sessions/{session_id}/messages")
def send_message(session_id: str, body: Utterance):
    orc = _get(session_id)
    return _view(session_id, orc, orc.handle_utterance(body.text))


@app.get("/api/dialogue/sessions/{session_id}")
def get_session(session_id: str):
    orc = _get(session_id)
    last = next((h["text"] for h in reversed(orc.session.history) if h["speaker"] == "Assistant"), "")
    return _view(session_id, orc, last)


@app.get("/api/rag/search")
def rag_search(q: str, top_k: int = 5):
    return {"query": q, "candidates": rag.search_policy(q, top_k=top_k)}


@app.post("/api/rag/decide")
def rag_decide(body: DecideRequest):
    try:
        d = rag.decide(body.item_id, body.cause, body.symptom, body.move_in_date)
    except KeyError as e:
        raise HTTPException(404, str(e))
    return {**d.as_dict(), "defect_type": rag.defect_type_of(body.item_id)}
