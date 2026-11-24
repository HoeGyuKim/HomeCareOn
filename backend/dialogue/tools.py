"""대화 엔진이 부르는 도구 API.

- lookup_household : 세대 DB 조회 (아직 목업)
- search_facility  : 수선유지 RAG 검색 — 거주자 말 → 기준표 항목 후보 (backend.rag)
- decide_cost      : 비용 부담 판정 — 항목·경위·입주일 → 부담 주체와 근거 (backend.rag, 규칙 코드)
- request_schedule : 방문 접수 요청 — 관리자 웹(frontend/defect-care) POST /api/intakes 로 접수 대기를 만들고
                     거주자에게 방문 희망일 선택 링크를 문자로 보냄. 날짜를 고르면 민원 접수.
                     웹이 꺼져 있으면 임시 접수번호를 발급하고 그 사실을 남긴다.
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
from backend.rag.liability import speak_name

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


def request_schedule(session_dict: Dict[str, Any]) -> Dict[str, Any]:
    """[C 파트] 방문 접수 요청.

    관리자 웹에 접수 대기를 만들고, 거주자에게 방문 희망일 선택 링크를 문자로 보낸다.
    거주자가 링크에서 날짜를 1~3개 고르면 그때 민원으로 접수되고 업체가 자동 배정된다.
    웹에 연결하지 못하면 임시 접수번호를 발급하고 실패 사유를 남긴다.
    """
    s = session_dict
    # 문자에 쓸 짧은 시설물 이름 (예: "화장실 배수트랩,배수관", "개별보일러")
    item = rag.get_item(s["facility_item_id"]) if s.get("facility_item_id") else None
    facility = speak_name(item) if item else (s.get("device_category") or "시설물")
    body = {"complaint": _complaint_payload(s), "facility": facility}

    if WEB_URL:
        req = urllib.request.Request(
            f"{WEB_URL.rstrip('/')}/api/intakes",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as res:
                r = json.loads(res.read().decode("utf-8"))
            return {"sent": True, "token": r["token"], "link": r["link"], "sms_text": r["smsText"], "sms_to": r["to"]}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            error = f"관리자 웹 접수 대기 생성 실패 ({e.code}): {detail[:200]}"
        except Exception as e:  # 웹이 꺼져 있는 경우 등
            error = f"관리자 웹 연결 실패: {e}"
    else:
        error = "관리자 웹 주소(HOMECAREON_WEB_URL)가 비어 있음"

    ticket_id = f"TKT-{datetime.now():%Y%m%d%H%M}-{uuid.uuid4().hex[:4].upper()}"
    return {"sent": False, "ticket_id": ticket_id, "error": error, "payload": body}


def mask_phone(phone: Optional[str]) -> str:
    """010-5678-1234 → 010-****-1234 (통화 중 번호를 다 읽지 않기 위함)"""
    d = _digits(phone)
    return f"{d[:3]}-****-{d[-4:]}" if len(d) >= 10 else "등록된 번호"
