"""대화 엔진이 부르는 도구 API.

- lookup_household : 세대 DB 조회 (아직 목업)
- search_facility  : 수선유지 RAG 검색 — 거주자 말 → 기준표 항목 후보 (backend.rag)
- decide_cost      : 비용 부담 판정 — 항목·경위·입주일 → 부담 주체와 근거 (backend.rag, 규칙 코드)
- create_ticket    : 접수 등록 — 관리자 웹(frontend/defect-care) POST /api/complaints 로 민원 등록 + 업체 자동 배정.
                     방문 일정은 관리자가 업체와 조율해 거주자에게 문자로 보냄. 웹이 꺼져 있으면 임시 접수번호 발급.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend import rag

# 관리자 웹 주소. 비우면 웹에 등록하지 않는다.
WEB_URL = os.getenv("HOMECAREON_WEB_URL", "http://127.0.0.1:3000")

# ── 세대 DB (목업) ─────────────────────────────
# apartment_name 은 관리자 웹의 등록 단지(src/lib/mock-data.ts APARTMENTS) 중 하나여야 업체 자동 배정이 된다.
MOCK_HOUSEHOLDS = {
    ("103동", "1204호"): {
        "resident_name": "홍길동",
        "phone": "010-5678-1234",
        "apartment_name": "한빛센트럴",
        "move_in_date": "2021-04-10",
        "devices": {
            "보일러": {"category": "개별보일러", "model": "경동나비엔 NCB353-20K", "year": 2017},
            "렌지후드": {"category": "주방기구", "model": "하츠 RHD-60", "year": 2017},
            "도어록": {"category": "현관문", "model": "밀레 디지털도어록", "year": 2020},
        },
    },
    ("101동", "501호"): {
        "resident_name": "이영희",
        "phone": "010-1111-2222",
        "apartment_name": "푸른숲마을",
        "move_in_date": "2023-01-15",
        "devices": {"보일러": {"category": "개별보일러", "model": "귀뚜라미 거꾸로 콘덴싱", "year": 2022}},
    },
    ("105동", "1501호"): {  # 입주 1개월 이내 세대: "입주후 1개월내" 기준 시험용
        "resident_name": "김민수",
        "phone": "010-3333-4444",
        "apartment_name": "새솔타운",
        "move_in_date": datetime.now().strftime("%Y-%m-%d"),
        "devices": {},
    },
}


def lookup_household(building: str, unit: str) -> Optional[Dict[str, Any]]:
    """[C 파트] 세대 DB 조회. 등록되지 않은 세대는 시연용 기본값을 돌려준다."""
    data = MOCK_HOUSEHOLDS.get((building, unit))
    if data is None:
        data = {
            "resident_name": "홍길동",
            "phone": "010-0000-0000",
            "apartment_name": "한빛센트럴",
            "move_in_date": "2020-01-01",
            "devices": {},
        }
    return {**data, "building": building, "unit": unit}


# ── 수선유지 RAG ───────────────────────────────

def search_facility(query: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """[B 파트] 거주자 말 → 기준표 항목 후보 (점수 순). 후보가 없으면 빈 목록."""
    return rag.search_policy(query, top_k=top_k)


def decide_cost(item_id: str, cause_detail: str = "", symptom: str = "",
                move_in_date: Optional[str] = None) -> Dict[str, Any]:
    """[B 파트] 비용 부담 판정. LLM이 아니라 기준표 규칙으로 정한다."""
    d = rag.decide(item_id, cause_text=cause_detail or "", symptom_text=symptom or "", move_in_date=move_in_date)
    return {
        "verdict": d.verdict,                       # SH_REPAIR | MGMT_FEE | SITE_CHECK | TENANT_PAY
        "liability_party": d.party,                 # 임대인(SH) | 관리비(공동부담) | 점검 후 결정 | 임차인(거주자)
        "resident_cost_possible": d.resident_cost_possible,
        "rule_id": d.item_id,
        "item_name": d.item_name,
        "basis_text": d.basis,
        "explanation": d.explanation,
        "causes": d.causes,
        "defect_type": rag.defect_type_of(d.item_id),
    }


def inspection_note(item_id: Optional[str], move_in_date: Optional[str] = None) -> str:
    """[B 파트] '원인을 어떻게 아나요?'에 대한 답: 방문 점검·SH 직원 검토 후 결정 + 점검 결과별 부담 (기준표 칸 그대로)."""
    return rag.inspection_note(item_id, move_in_date)


# ── 접수 등록 ──────────────────────────────────

URGENT = re.compile(r"가스|누전|불꽃|타는\s?냄새|연기|물이?\s?(쏟|넘쳐|많이)|갇혔|갇힘")


def _digits(s: Optional[str]) -> str:
    return re.sub(r"\D", "", s or "")


def _complaint_payload(s: Dict[str, Any]) -> Dict[str, Any]:
    """관리자 웹의 민원 입력 형식(ComplaintInput)으로 변환."""
    transcript = "\n".join(
        f"{'상담원(AI)' if h['speaker'] == 'Assistant' else '민원인'}: {h['text']}" for h in s.get("history", [])
    )
    text_all = " ".join(filter(None, [s.get("symptom"), s.get("cause_detail")]))
    return {
        "complainantName": s.get("resident_name") or "",
        "phone": s.get("phone") or "",
        "apartmentName": s.get("apartment_name") or "",
        "building": _digits(s.get("building")),
        "unit": _digits(s.get("unit")),
        "defectType": s.get("defect_type") or "ETC",
        "urgency": "HIGH" if URGENT.search(text_all) else "NORMAL",
        "description": " / ".join(filter(None, [
            f"[{s.get('facility_name')}]" if s.get("facility_name") else None,
            s.get("symptom"),
            f"경위: {s['cause_detail']}" if s.get("cause_detail") else None,
        ])),
        "channel": "PHONE_AI",
        "callTranscript": transcript,
        "aiSummary": (
            f"[비용판정: {s.get('liability_party')}] {s.get('facility_name')} — "
            f"{s.get('liability_explanation') or ''} 근거: {s.get('liability_reason') or ''}"
        ),
    }


def create_ticket(session_dict: Dict[str, Any]) -> Dict[str, Any]:
    """[C 파트] 접수 등록. 관리자 웹(POST /api/complaints)에 민원으로 올리고 접수번호·자동 배정 업체를 돌려준다.

    방문 일정은 여기서 정하지 않는다. 관리자가 민원 상세에서 배정 업체와 조율한 뒤 거주자에게 일정 선택 문자를 보낸다.
    웹에 연결하지 못하면 임시 접수번호를 발급하고 실패 사유를 남긴다.
    """
    payload = _complaint_payload(session_dict)
    if WEB_URL:
        req = urllib.request.Request(
            f"{WEB_URL.rstrip('/')}/api/complaints",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as res:
                body = json.loads(res.read().decode("utf-8"))
            c = body.get("complaint", {})
            a = body.get("assignment") or {}
            return {
                "registered": True,
                "ticket_id": c.get("receiptNo") or c.get("id"),
                "complaint_id": c.get("id"),
                "contractor_name": (a.get("contractor") or {}).get("name"),
            }
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            error = f"관리자 웹 등록 실패 ({e.code}): {detail[:200]}"
        except Exception as e:  # 웹이 꺼져 있는 경우 등
            error = f"관리자 웹 연결 실패: {e}"
    else:
        error = "관리자 웹 주소(HOMECAREON_WEB_URL)가 비어 있음"

    ticket_id = f"TKT-{datetime.now():%Y%m%d%H%M}-{uuid.uuid4().hex[:4].upper()}"
    return {"registered": False, "ticket_id": ticket_id, "error": error, "payload": payload}


def mask_phone(phone: Optional[str]) -> str:
    """010-5678-1234 → 010-****-1234 (통화 중 번호를 다 읽지 않기 위함)"""
    d = _digits(phone)
    return f"{d[:3]}-****-{d[-4:]}" if len(d) >= 10 else "등록된 번호"
