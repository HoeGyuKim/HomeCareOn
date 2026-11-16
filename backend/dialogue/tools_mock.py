"""
팀원들의 B, C 파트(DB, RAG, 백엔드)와 연동하기 전까지 사용할 목업(Mock) 도구 API 모듈

README 설계 원칙:
"세 파트는 도구 API(세대 조회, 정책 검색·판정, 티켓 생성)를 경계로 나뉩니다.
API 형식을 먼저 합의하면 A는 목업 응답으로, B·C는 각자 구현으로 병렬 개발할 수 있습니다."
"""
from typing import Dict, Any, Optional
import uuid
from datetime import datetime


def lookup_household(building: str, unit: str) -> Dict[str, Any]:
    """
    [C 파트 김회규 담당 API]
    동/호수로 세대 거주자 정보 및 설치 설비(보일러, 도어록 등) 목록을 조회합니다.
    """
    # 목업 세대 데이터
    return {
        "building": building,
        "unit": unit,
        "resident_name": "홍길동",
        "phone": "010-5678-1234",
        "move_in_date": "2021-04-10",  # 입주 1개월 초과 (노후 판단 기준)
        "devices": {
            "보일러": {
                "category": "개별보일러",
                "model": "경동나비엔 NCB353-20K",
                "installed_year": 2017
            },
            "렌지후드": {
                "category": "주방기구",
                "model": "하츠 RHD-60",
                "installed_year": 2017
            },
            "도어록": {
                "category": "현관문",
                "model": "밀레 디지털도어록",
                "installed_year": 2020
            }
        }
    }


def search_policy_and_decide(
    device_category: str,
    symptom: str,
    error_code: Optional[str] = None,
    move_in_date: Optional[str] = None
) -> Dict[str, Any]:
    """
    [B 파트 조준혁 담당 API: search_policy() & decide_liability()]
    설비 종류, 증상, 에러코드, 입주일 정보를 바탕으로 수선유지 기준표에서
    비용 부담 주체(SH / 거주자)와 근거 조항을 판정합니다.
    """
    # 1. 보일러 점화 불량 / 에러 03 케이스
    if "보일러" in device_category or "보일러" in symptom:
        if error_code == "03" or "온수" in symptom or "점화" in symptom:
            return {
                "liability_party": "임대인(SH)",
                "resident_cost_possible": True,
                "rule_id": "1-9-02",
                "basis_text": "건물 전용부분 > 개별보일러 > 단위세대 개별보일러 시설물: 임대인(SH) 부담 - 작동불량 교체. 임차인 부담 - 파손,동파.",
                "explanation": (
                    "설치된 보일러 기준 에러 03은 점화 불량입니다. "
                    "수선유지 기준상 자연 노후로 인한 고장은 SH가 부담합니다. "
                    "다만 현장 점검 결과 사용 부주의나 동파로 확인될 경우 거주자 부담 비용이 발생할 수 있습니다."
                )
            }

    # 2. 전등/스위치/소모품 케이스 (거주자 부담 예시)
    if any(k in symptom for k in ["형광등", "전구", "건전지", "소모품"]):
        return {
            "liability_party": "임차인(거주자)",
            "resident_cost_possible": True,
            "rule_id": "1-7-01",
            "basis_text": "전기설비 소모품(전구, 형광등 등) 교체: 임차인 부담",
            "explanation": (
                "전구 및 형광등 등 단순 소모품 교체는 수선유지 기준상 거주자 부담 항목입니다. "
                "직접 교체하시거나 관리사무소에 문의하시기 바랍니다."
            )
        }

    # 3. 기본 일반 고장 케이스 (현장 점검 후 판정)
    return {
        "liability_party": "점검 후 결정",
        "resident_cost_possible": True,
        "rule_id": "일반규정",
        "basis_text": "시설물 수선유지 기준 제2장 비용부담 원칙",
        "explanation": (
            "접수해 주신 증상은 현장 기사님의 점검 후 노후 고장 여부(SH 부담) 또는 "
            "사용 부주의 여부에 따라 비용 부담 주체가 최종 확정됩니다."
        )
    }


def create_ticket(session_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    [C 파트 김회규 담당 API]
    접수 확정된 민원 내용을 관리자 시스템(SH 직원 웹)에 티켓으로 등록합니다.
    """
    now_str = datetime.now().strftime("%Y%m%d%H%M")
    ticket_id = f"TKT-{now_str}-{uuid.uuid4().hex[:4].upper()}"
    return {
        "success": True,
        "ticket_id": ticket_id,
        "status": "접수완료",
        "message": "SH 시설물 관리 시스템에 민원 티켓이 성공적으로 등록되었습니다."
    }
