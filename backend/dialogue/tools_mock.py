"""
팀원들의 B, C 파트(DB, RAG, 백엔드)와 연동하기 전까지 사용할 목업(Mock) 도구 API 모듈
"""
from typing import Dict, Any, Optional
import uuid
import re
from datetime import datetime

# 목업 세대 DB (SH 공사 등록 데이터)
MOCK_HOUSEHOLDS = {
    ("103동", "1204호"): {
        "resident_name": "홍길동",
        "phone": "010-5678-1234",
        "move_in_date": "2021-04-10",
        "devices": {
            "보일러": {"category": "개별보일러", "model": "경동나비엔 NCB353-20K", "year": 2017},
            "렌지후드": {"category": "주방기구", "model": "하츠 RHD-60", "year": 2017},
            "도어록": {"category": "현관문", "model": "밀레 디지털도어록", "year": 2020}
        }
    },
    ("101동", "501호"): {
        "resident_name": "이영희",
        "phone": "010-1111-2222",
        "move_in_date": "2023-01-15",
        "devices": {
            "보일러": {"category": "개별보일러", "model": "귀뚜라미 거꾸로 콘덴싱", "year": 2022}
        }
    }
}


def lookup_household(building: str, unit: str) -> Optional[Dict[str, Any]]:
    """[C 파트 김회규 담당 API] 세대 DB 조회"""
    key = (building, unit)
    if key in MOCK_HOUSEHOLDS:
        data = MOCK_HOUSEHOLDS[key].copy()
        data["building"] = building
        data["unit"] = unit
        return data

    return {
        "building": building,
        "unit": unit,
        "resident_name": "홍길동",
        "phone": "010-0000-0000",
        "move_in_date": "2020-01-01",
        "devices": {
            "보일러": {"category": "개별보일러", "model": "경동나비엔 NCB353-20K", "year": 2018}
        }
    }


def search_policy_and_decide(
    device_category: str,
    symptom: str,
    cause_detail: Optional[str] = None,
    error_code: Optional[str] = None,
    move_in_date: Optional[str] = None
) -> Dict[str, Any]:
    """[B 파트 조준혁 담당 API: search_policy() & decide_liability()]"""
    cause_str = (cause_detail or "").strip()
    symptom_str = symptom or ""

    # 부정어 처리 ("충격 준 적 없고", "깨진 건 아니고", "동파 아님" 등)
    negations = ["없", "아니", "안", "그냥", "자연", "갑자기"]
    has_negated_carelessness = any(n in cause_str for n in negations)

    # 명시적 본인 과실 표현 ("내가 건드렸", "실수로 쳤", "실수로 부러", "깨뜨렸")
    is_explicit_careless = any(w in cause_str for w in ["실수로", "내가 쳤", "내가 건드렸", "깨뜨렸", "부러뜨렸"])

    if "보일러" in device_category or "보일러" in symptom_str or "온수" in symptom_str or "난방" in symptom_str:
        if is_explicit_careless:
            return {
                "liability_party": "임차인(거주자)",
                "resident_cost_possible": True,
                "rule_id": "1-9-02",
                "basis_text": "개별보일러 시설물: 임차인 부담 - 파손, 동파 및 관리 부주의",
                "explanation": (
                    "말씀해 주신 상황은 수선유지 기준상 사용자 부주의나 파손으로 분류될 수 있어, "
                    "기사님 점검 후 거주자 부담 비용이 발생할 가능성이 높습니다."
                )
            }
        else:
            return {
                "liability_party": "임대인(SH)",
                "resident_cost_possible": True,
                "rule_id": "1-9-02",
                "basis_text": "개별보일러 시설물: 임대인(SH) 부담 - 작동불량 교체(자연 노후)",
                "explanation": (
                    "정상적인 사용 중 발생한 노후 고장으로 보이며, 수선유지 기준상 수리비는 SH에서 전액 부담합니다. "
                    "다만 현장 점검 결과 실제 사용 부주의나 동파 흔적이 확인될 경우에는 본인 부담 비용이 발생할 수 있습니다."
                )
            }

    # 일반 전용설비
    return {
        "liability_party": "점검 후 결정",
        "resident_cost_possible": True,
        "rule_id": "일반규정",
        "basis_text": "시설물 수선유지 기준 제2장 비용부담 원칙",
        "explanation": (
            "수선유지 기준상 자연 노후 고장은 SH가 부담하나, 사용자 부주의나 파손 여부에 따라 거주자 부담이 발생할 수 있어 현장 점검 후 최종 확정됩니다."
        )
    }


def create_ticket(session_dict: Dict[str, Any]) -> Dict[str, Any]:
    """[C 파트 김회규 담당 API] 티켓 등록"""
    now_str = datetime.now().strftime("%Y%m%d%H%M")
    ticket_id = f"TKT-{now_str}-{uuid.uuid4().hex[:4].upper()}"
    return {
        "success": True,
        "ticket_id": ticket_id,
        "status": "접수완료",
        "message": "SH 시설물 관리 시스템에 민원 티켓이 성공적으로 등록되었습니다."
    }
