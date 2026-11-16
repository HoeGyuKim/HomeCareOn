"""
HomeCareOn 대화 엔진 상태 및 세션 데이터 정의 모듈
"""
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class DialogueState(str, Enum):
    """대화 오케스트레이터의 단계(State) 정의"""
    INIT = "INIT"                     # 통화 연결 직후 초기 상태
    ASK_DONG_HO = "ASK_DONG_HO"       # 동/호수 질문 및 수집 상태
    ASK_SYMPTOM = "ASK_SYMPTOM"       # 고장 설비 및 증상/에러코드 수집 상태
    LOOKUP_DEVICE = "LOOKUP_DEVICE"   # 세대 DB 조회 및 설비 모델 매칭 상태
    ADVISE_COST = "ADVISE_COST"       # RAG 수선비용 부담 기준 안내 상태
    CONFIRM_RECEIPT = "CONFIRM_RECEIPT" # 접수 진행 여부 확인 상태
    TICKET_ISSUED = "TICKET_ISSUED"   # 접수 티켓 생성 완료 상태
    CLOSED = "CLOSED"                 # 통화 종료 상태


class SessionData(BaseModel):
    """1회 통화 세션 동안 수집/유지되는 민원 데이터 모델"""
    # 1. 세대 정보 (김회규 파트 DB 연동)
    building: Optional[str] = Field(None, description="동 (예: 103동)")
    unit: Optional[str] = Field(None, description="호수 (예: 1204호)")
    resident_name: Optional[str] = Field(None, description="거주자 성명")
    phone: Optional[str] = Field(None, description="연락처")
    move_in_date: Optional[str] = Field(None, description="입주일 (YYYY-MM-DD)")

    # 2. 설비 및 고장 증상 정보
    device_category: Optional[str] = Field(None, description="설비 분류 (예: 개별보일러, 렌지후드, 도어록 등)")
    device_model: Optional[str] = Field(None, description="설비 모델명 (예: 경동나비엔 NCB353-20K)")
    symptom: Optional[str] = Field(None, description="고장 증상 요약 (예: 온수 안 나옴, 점화 불량)")
    error_code: Optional[str] = Field(None, description="표시 에러코드 (예: 03)")

    # 3. 비용 부담 판정 정보 (조준혁 파트 RAG 연동)
    liability_party: Optional[str] = Field(None, description="부담 주체: 임대인(SH) / 임차인(거주자) / 점검 후 결정")
    liability_reason: Optional[str] = Field(None, description="판정 근거 규정/조항")
    resident_cost_possible: bool = Field(False, description="사용자 부주의 시 거주자 비용 발생 가능성 여부")

    # 4. 접수 티켓 정보 (백엔드 전송)
    ticket_id: Optional[str] = Field(None, description="생성된 티켓 ID")
    call_summary: Optional[str] = Field(None, description="통화 1줄 요약")
    
    # 대화 기록 (User / Assistant)
    history: List[Dict[str, str]] = Field(default_factory=list, description="대화 로그")
