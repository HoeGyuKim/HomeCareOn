"""
HomeCareOn 대화 엔진 상태 및 세션 데이터 정의 모듈 (개선 버전)
"""
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class DialogueState(str, Enum):
    """대화 오케스트레이터의 단계(State) 정의"""
    INIT = "INIT"                           # 초기 상태
    IDENTIFY_RESIDENT = "IDENTIFY_RESIDENT" # 동·호수 및 계약자 성함 확인
    ASK_FACILITY = "ASK_FACILITY"           # 어떤 시설물에 문제가 있는지 질문 (에러코드 등 기술 용어 제외)
    PROBE_CAUSE = "PROBE_CAUSE"             # 고장 발생 경위 및 노후/부주의/상태 확인 질문
    ADVISE_COST = "ADVISE_COST"             # 수선비용 부담 기준 안내 및 기사 방문 접수 여부 확인
    SCHEDULE_SENT = "SCHEDULE_SENT"         # 방문 희망일 선택 링크 문자 발송 → 통화 종료 (날짜를 고르면 접수 완료)
    TICKET_ISSUED = "TICKET_ISSUED"         # 문자 발송 실패 시 임시 접수번호만 발급하고 종료
    CLOSED = "CLOSED"                       # 통화 종료 (접수 안 함)


class SessionData(BaseModel):
    """1회 통화 세션 동안 수집/유지되는 민원 데이터 모델"""
    # 1. 세대 정보 (김회규 파트 DB 연동 및 본인 확인)
    building: Optional[str] = Field(None, description="동 (예: 103동)")
    unit: Optional[str] = Field(None, description="호수 (예: 1204호)")
    resident_name: Optional[str] = Field(None, description="발화된 고객 성함")
    db_resident_name: Optional[str] = Field(None, description="SH DB 상의 계약자 성함")
    is_resident_verified: bool = Field(False, description="DB 상의 이름과 일치 여부")
    phone: Optional[str] = Field(None, description="연락처")
    apartment_name: Optional[str] = Field(None, description="단지명 (관리자 웹 등록 단지)")
    move_in_date: Optional[str] = Field(None, description="입주일 (YYYY-MM-DD)")

    # 2. 설비 및 고장 내용
    device_category: Optional[str] = Field(None, description="설비 분류 (예: 개별보일러, 렌지후드 등)")
    device_model: Optional[str] = Field(None, description="설비 모델명")
    symptom: Optional[str] = Field(None, description="고장 증상 요약")
    cause_detail: Optional[str] = Field(None, description="전화로 파악한 고장 경위/부주의 여부 답변")
    error_code: Optional[str] = Field(None, description="에러코드 (고객이 자발적으로 말한 경우에만 수집)")
    facility_item_id: Optional[str] = Field(None, description="RAG로 찾은 기준표 항목 id (예: 1-9-11)")
    facility_name: Optional[str] = Field(None, description="기준표 항목 이름 (예: 개별보일러 > 기타부품)")
    facility_candidates: List[Dict[str, Any]] = Field(default_factory=list, description="RAG 검색 후보")
    defect_type: Optional[str] = Field(None, description="관리자 웹 하자 유형 코드 (HVAC 등)")
    facility_retry: int = Field(0, description="시설물을 못 찾아 다시 물어본 횟수")

    # 3. 비용 부담 판정 정보 (수선유지 RAG)
    liability_verdict: Optional[str] = Field(None, description="SH_REPAIR | MGMT_FEE | SITE_CHECK | TENANT_PAY")
    liability_party: Optional[str] = Field(None, description="부담 주체: 임대인(SH) / 관리비(공동부담) / 점검 후 결정 / 임차인(거주자)")
    liability_reason: Optional[str] = Field(None, description="판정 근거 (기준표 원문)")
    liability_explanation: Optional[str] = Field(None, description="거주자에게 안내한 판정 설명")
    resident_cost_possible: bool = Field(False, description="사용자 부주의 시 거주자 비용 발생 가능성 여부")

    # 4. 접수 (거주자가 문자 링크에서 방문 희망일을 고르면 관리자 웹에 민원으로 접수됨)
    intake_token: Optional[str] = Field(None, description="관리자 웹 접수 대기 토큰")
    schedule_link: Optional[str] = Field(None, description="방문 희망일 선택 링크")
    sms_text: Optional[str] = Field(None, description="거주자에게 보낸 문자 내용")
    sms_to: Optional[str] = Field(None, description="문자 받은 번호")
    ticket_id: Optional[str] = Field(None, description="문자 발송 실패 시 발급한 임시 접수번호")
    ticket_error: Optional[str] = Field(None, description="관리자 웹 연결·문자 발송 실패 사유")
    call_summary: Optional[str] = Field(None, description="통화 1줄 요약")
    
    # 대화 기록 (User / Assistant)
    history: List[Dict[str, str]] = Field(default_factory=list, description="대화 로그")
