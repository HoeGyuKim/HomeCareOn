"""접수 티켓·방문 일정 확정·업체 전달·문자 알림 (README 도구 API: 티켓 생성, 관리자 웹 처리).

방문 일정은 AI가 잡지 않는다. 직원이 관리자 웹에서 확정하면 거주자에게 문자를 보낸다 (지금은 목업 기록).
"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FACILITIES, Notification, Ticket, Vendor

WEEKDAYS = "월화수목금토일"
BASIS_KEYS = ("item_path", "source", "landlord_text", "tenant_text", "reason", "principles", "caveat_causes", "matched_cause", "say")


def hour_label(dt: datetime) -> str:
    ampm, h = ("오전", dt.hour) if dt.hour < 12 else ("오후", dt.hour - 12 if dt.hour > 12 else 12)
    return f"{ampm} {h}시" + (f" {dt.minute}분" if dt.minute else "")


def visit_label(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return f"{dt.month}월 {dt.day}일({WEEKDAYS[dt.weekday()]}) {hour_label(dt)}"


# ---------------------------------------------------------------- 티켓 생성 (AI)
def create_ticket(
    db: Session,
    *,
    household_id: int | None,
    facility: str | None,
    symptom: str | None,
    error_code: str | None,
    error_meaning: str | None,
    equipment: str | None,
    liability: dict | None,
    summary: str,
    transcript: list[dict],
    status: str,
    now: datetime,
    urgent: bool = False,
    review_reason: str | None = None,
) -> Ticket:
    liability = liability or {}
    ticket = Ticket(
        created_at=now,
        updated_at=now,
        household_id=household_id,
        facility=facility,
        symptom=symptom,
        error_code=error_code,
        error_meaning=error_meaning,
        equipment=equipment,
        item_id=liability.get("item_id"),
        item_label=liability.get("item_label"),
        payer_initial=liability.get("payer"),
        tenant_cost_possible=bool(liability.get("tenant_cost_possible")),
        basis={k: liability.get(k) for k in BASIS_KEYS if liability.get(k) is not None},
        summary=summary,
        transcript=list(transcript),
        status=status,
        urgent=urgent,
        review_reason=review_reason,
    )
    db.add(ticket)
    db.commit()
    return ticket


def save_transcript(db: Session, ticket_id: int, transcript: list[dict]) -> None:
    ticket = db.get(Ticket, ticket_id)
    if ticket:
        ticket.transcript = list(transcript)
        db.commit()


# ---------------------------------------------------------------- 조회
def list_tickets(db: Session, status: str | None = None) -> list[Ticket]:
    q = select(Ticket).order_by(Ticket.id.desc())
    if status:
        q = q.where(Ticket.status == status)
    return list(db.scalars(q))


def list_notifications(db: Session, ticket_id: int | None = None, limit: int = 100) -> list[Notification]:
    q = select(Notification).order_by(Notification.id.desc()).limit(limit)
    if ticket_id is not None:
        q = q.where(Notification.ticket_id == ticket_id)
    return list(db.scalars(q))


def list_vendors(db: Session) -> list[Vendor]:
    return list(db.scalars(select(Vendor).order_by(Vendor.id)))


def recommend_vendor(db: Session, facility: str | None) -> Vendor | None:
    """설비 분류가 맞는 전문 업체를 먼저, 없으면 종합 업체를 추천한다."""
    vendors = list_vendors(db)
    specialists = [v for v in vendors if facility in v.specialties and len(v.specialties) < len(FACILITIES)]
    generalists = [v for v in vendors if len(v.specialties) >= len(FACILITIES)]
    return (specialists or generalists or [None])[0]


# ---------------------------------------------------------------- 직원 처리
def schedule_visit(db: Session, ticket: Ticket, visit_at: datetime, vendor_id: int | None, now: datetime) -> Notification:
    """방문 일정 확정 → 거주자에게 문자 안내."""
    if vendor_id is not None:
        ticket.vendor_id = vendor_id
    ticket.visit_at = visit_at
    ticket.scheduled_at = now
    if ticket.status in ("접수", "직원 확인 필요"):
        ticket.status = "일정 확정"
    ticket.updated_at = now
    db.flush()
    db.refresh(ticket)
    h = ticket.household
    n = Notification(ticket_id=ticket.id, kind="방문 일정 안내", to_name=h.resident_name, to_phone=h.phone,
                     message=sms_text(ticket), created_at=now)
    db.add(n)
    db.commit()
    return n


def forward_to_vendor(db: Session, ticket: Ticket, vendor: Vendor, now: datetime) -> Notification:
    """업체·기사에 정리된 접수 내용을 그대로 전달."""
    ticket.vendor_id = vendor.id
    ticket.forwarded_at = now
    ticket.updated_at = now
    db.flush()
    db.refresh(ticket)
    n = Notification(ticket_id=ticket.id, kind="업체 전달", to_name=f"{vendor.name} {vendor.contact_name}",
                     to_phone=vendor.phone, message=forward_text(ticket), created_at=now)
    db.add(n)
    db.commit()
    return n


# ---------------------------------------------------------------- 문구
def sms_text(ticket: Ticket) -> str:
    h, v = ticket.household, ticket.vendor
    lines = [f"[SH 시설물 접수] {h.dong}동 {h.ho}호 {ticket.facility or '시설물'} 점검 방문 일정이 "
             f"{visit_label(ticket.visit_at)}로 확정되었습니다."]
    if v:
        lines.append(f"방문 업체: {v.name} ({v.phone})")
    lines.append(f"접수번호 {ticket.id}")
    return "\n".join(lines)


def forward_text(ticket: Ticket) -> str:
    h, b = ticket.household, ticket.basis or {}
    symptom = ticket.symptom or "-"
    if ticket.error_code:
        symptom += f" / 에러 {ticket.error_code}" + (f"({ticket.error_meaning})" if ticket.error_meaning else "")
    payer = ticket.payer_final or ticket.payer_initial or "-"
    payer_note = "현장 확정" if ticket.payer_final else "사전 판단" + (", 거주자 비용 발생 가능" if ticket.tenant_cost_possible else "")
    lines = [
        f"[SH 시설물 수리 요청] 접수번호 {ticket.id}",
        f"주소: {h.complex} {h.dong}동 {h.ho}호 / 거주자 {h.resident_name} ({h.phone})" if h else "주소: 확인 필요",
        f"설비: {ticket.equipment or ticket.facility or '-'}",
        f"증상: {symptom}",
    ]
    if ticket.item_label:
        lines.append(f"기준 항목: {ticket.item_label} [{ticket.item_id}]")
    lines.append(f"비용 부담: {payer} ({payer_note})")
    if b.get("landlord_text") or b.get("tenant_text"):
        lines.append(f" - 기준 원문: 임대인(SH) 부담 '{b.get('landlord_text') or '-'}' / 임차인 부담 '{b.get('tenant_text') or '-'}'")
    lines.append(f"방문 일정: {visit_label(ticket.visit_at) or '협의 필요'}")
    lines.append("요청: 현장 점검 후 비용 부담 주체를 확인해 회신 바랍니다.")
    return "\n".join(lines)
