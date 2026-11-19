"""DB 테이블 정의 (C 담당). SQLite로 시작하고 DATABASE_URL만 바꾸면 다른 DB로 옮길 수 있다."""
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# README: 접수 → 일정 확정 → 처리 중 → 완료, 판단이 어려우면 '직원 확인 필요'
TICKET_STATUSES = ["접수", "직원 확인 필요", "일정 확정", "처리 중", "완료"]
FACILITIES = ["보일러", "누수", "전기", "문·창호", "주방", "욕실", "가스", "기타"]


class Household(Base):
    """세대: 동·호수, 거주자 연락처, 입주일 (입주일은 '입주후 1개월내' 기준 판정에 쓴다)."""
    __tablename__ = "households"
    __table_args__ = (UniqueConstraint("complex", "dong", "ho"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    complex: Mapped[str] = mapped_column(String(50))
    dong: Mapped[int]
    ho: Mapped[int]
    resident_name: Mapped[str] = mapped_column(String(30))
    phone: Mapped[str] = mapped_column(String(20))
    move_in_date: Mapped[date] = mapped_column(Date)

    equipment: Mapped[list["Equipment"]] = relationship(back_populates="household")


class Equipment(Base):
    """세대별 설치 설비. 에러코드 해석에 제조사·모델이 필요하다."""
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    kind: Mapped[str] = mapped_column(String(20))  # 보일러 등
    manufacturer: Mapped[str] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(30))
    installed_year: Mapped[int]

    household: Mapped[Household] = relationship(back_populates="equipment")


class Vendor(Base):
    """수리 업체·기사. 직원이 티켓을 보고 지정해 접수 내용을 전달한다."""
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    contact_name: Mapped[str] = mapped_column(String(30))
    phone: Mapped[str] = mapped_column(String(20))
    specialties: Mapped[list[str]] = mapped_column(JSON)  # 처리 가능한 설비 분류


class Ticket(Base):
    """접수 티켓. 직원이 업체에 다시 설명할 필요가 없도록 전달에 필요한 내용을 모두 담는다."""
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
    household_id: Mapped[int | None] = mapped_column(ForeignKey("households.id"))

    # 접수 내용 (AI)
    facility: Mapped[str | None] = mapped_column(String(20))
    symptom: Mapped[str | None] = mapped_column(String(200))
    error_code: Mapped[str | None] = mapped_column(String(20))
    error_meaning: Mapped[str | None] = mapped_column(String(50))
    equipment: Mapped[str | None] = mapped_column(String(100))  # 접수 시점의 설비 모델 (스냅샷)
    item_id: Mapped[str | None] = mapped_column(String(20))  # 수선유지 기준 항목 id
    item_label: Mapped[str | None] = mapped_column(String(100))
    payer_initial: Mapped[str | None] = mapped_column(String(20))  # AI 사전 안내: SH / 거주자 / 점검 후 결정 / 직원 확인 필요
    tenant_cost_possible: Mapped[bool] = mapped_column(default=False)
    basis: Mapped[dict] = mapped_column(JSON, default=dict)  # 근거: 기준 원문, 판정 사유, 조항
    summary: Mapped[str] = mapped_column(Text, default="")  # 통화 요약
    transcript: Mapped[list[dict]] = mapped_column(JSON, default=list)
    urgent: Mapped[bool] = mapped_column(default=False)
    review_reason: Mapped[str | None] = mapped_column(String(100))

    # 처리 (SH 직원)
    status: Mapped[str] = mapped_column(String(20), default="접수")
    payer_final: Mapped[str | None] = mapped_column(String(20))  # 현장 점검 후 확정
    visit_at: Mapped[datetime | None] = mapped_column(DateTime)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)  # 방문 일정 문자 발송 시각
    forwarded_at: Mapped[datetime | None] = mapped_column(DateTime)  # 업체 전달 시각
    memo: Mapped[str] = mapped_column(Text, default="")

    household: Mapped[Household | None] = relationship()
    vendor: Mapped[Vendor | None] = relationship()


class Notification(Base):
    """발송 기록. 지금은 실제로 보내지 않고 기록만 남기는 목업."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"))
    kind: Mapped[str] = mapped_column(String(20))  # 방문 일정 안내 / 업체 전달
    to_name: Mapped[str] = mapped_column(String(50))
    to_phone: Mapped[str] = mapped_column(String(20))
    channel: Mapped[str] = mapped_column(String(20), default="문자(목업)")
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime)
