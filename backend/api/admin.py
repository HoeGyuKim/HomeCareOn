"""관리자 웹 API (SH 직원). README: 티켓 확인 → 방문 일정 확정·문자 안내 → 업체·기사 전달 → 상태 관리.
MVP라 인증이 없으니 외부에 공개하지 말 것.
"""
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DB

from ..knowledge import cost_standard as cs
from ..models import TICKET_STATUSES, Ticket, Vendor
from ..tools import tickets
from .deps import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])

Status = Literal["접수", "직원 확인 필요", "일정 확정", "처리 중", "완료"]


class TicketSummary(BaseModel):
    id: int
    created_at: datetime
    address: str | None
    facility: str | None
    symptom: str | None
    error_code: str | None
    payer_initial: str | None
    tenant_cost_possible: bool
    payer_final: str | None
    status: str
    urgent: bool
    visit_at: datetime | None
    vendor_name: str | None
    forwarded: bool


class TicketDetail(TicketSummary):
    resident_name: str | None
    resident_phone: str | None
    move_in_date: date | None
    equipment: str | None
    error_meaning: str | None
    item_id: str | None
    item_label: str | None
    basis: dict
    principles: list[dict]
    summary: str
    transcript: list[dict]
    memo: str
    review_reason: str | None
    vendor_id: int | None
    vendor_phone: str | None
    scheduled_at: datetime | None
    forwarded_at: datetime | None
    recommended_vendor_id: int | None
    forward_text: str
    notifications: list[dict]


class TicketUpdate(BaseModel):
    status: Status | None = None
    payer_final: Literal["SH", "거주자"] | None = None
    memo: str | None = None


class ScheduleIn(BaseModel):
    visit_at: datetime
    vendor_id: int | None = None


class ForwardIn(BaseModel):
    vendor_id: int


def _summary(t: Ticket) -> dict:
    h = t.household
    return {
        "id": t.id,
        "created_at": t.created_at,
        "address": f"{h.dong}동 {h.ho}호" if h else None,
        "facility": t.facility,
        "symptom": t.symptom,
        "error_code": t.error_code,
        "payer_initial": t.payer_initial,
        "tenant_cost_possible": t.tenant_cost_possible,
        "payer_final": t.payer_final,
        "status": t.status,
        "urgent": t.urgent,
        "visit_at": t.visit_at,
        "vendor_name": t.vendor.name if t.vendor else None,
        "forwarded": t.forwarded_at is not None,
    }


def _notification(n) -> dict:
    return {"id": n.id, "ticket_id": n.ticket_id, "kind": n.kind, "to_name": n.to_name, "to_phone": n.to_phone,
            "channel": n.channel, "message": n.message, "created_at": n.created_at}


def _detail(db: DB, t: Ticket) -> TicketDetail:
    h = t.household
    recommended = tickets.recommend_vendor(db, t.facility)
    return TicketDetail(
        **_summary(t),
        resident_name=h.resident_name if h else None,
        resident_phone=h.phone if h else None,
        move_in_date=h.move_in_date if h else None,
        equipment=t.equipment,
        error_meaning=t.error_meaning,
        item_id=t.item_id,
        item_label=t.item_label,
        basis=t.basis or {},
        principles=cs.principle_texts((t.basis or {}).get("principles") or []),
        summary=t.summary,
        transcript=t.transcript,
        memo=t.memo,
        review_reason=t.review_reason,
        vendor_id=t.vendor_id,
        vendor_phone=t.vendor.phone if t.vendor else None,
        scheduled_at=t.scheduled_at,
        forwarded_at=t.forwarded_at,
        recommended_vendor_id=recommended.id if recommended else None,
        forward_text=tickets.forward_text(t),
        notifications=[_notification(n) for n in tickets.list_notifications(db, ticket_id=t.id)],
    )


def _get(db: DB, ticket_id: int) -> Ticket:
    t = db.get(Ticket, ticket_id)
    if t is None:
        raise HTTPException(404, "접수 건이 없습니다.")
    return t


@router.get("/tickets", response_model=list[TicketSummary])
def list_tickets(status: str | None = None, db: DB = Depends(get_db)):
    return [TicketSummary(**_summary(t)) for t in tickets.list_tickets(db, status)]


@router.get("/tickets/{ticket_id}", response_model=TicketDetail)
def get_ticket(ticket_id: int, db: DB = Depends(get_db)):
    return _detail(db, _get(db, ticket_id))


@router.patch("/tickets/{ticket_id}", response_model=TicketDetail)
def update_ticket(ticket_id: int, body: TicketUpdate, db: DB = Depends(get_db)):
    t = _get(db, ticket_id)
    if body.status is not None:
        t.status = body.status
    if body.payer_final is not None:
        t.payer_final = body.payer_final
    if body.memo is not None:
        t.memo = body.memo
    t.updated_at = datetime.now()
    db.commit()
    return _detail(db, t)


@router.post("/tickets/{ticket_id}/schedule", response_model=TicketDetail)
def schedule(ticket_id: int, body: ScheduleIn, db: DB = Depends(get_db)):
    """방문 일정 확정 → 거주자에게 문자 안내 (목업)."""
    t = _get(db, ticket_id)
    if t.household is None:
        raise HTTPException(400, "세대가 확인되지 않은 접수 건입니다. 세대를 먼저 확인해 주세요.")
    if body.vendor_id is not None and db.get(Vendor, body.vendor_id) is None:
        raise HTTPException(400, "업체를 찾을 수 없습니다.")
    now = datetime.now()
    visit_at = body.visit_at.replace(tzinfo=None, second=0, microsecond=0)
    if visit_at < now:
        raise HTTPException(400, "방문 일시는 현재 시각 이후여야 합니다.")
    tickets.schedule_visit(db, t, visit_at, body.vendor_id, now)
    return _detail(db, t)


@router.post("/tickets/{ticket_id}/forward", response_model=TicketDetail)
def forward(ticket_id: int, body: ForwardIn, db: DB = Depends(get_db)):
    """업체·기사에 정리된 접수 내용 전달 (목업)."""
    t = _get(db, ticket_id)
    vendor = db.get(Vendor, body.vendor_id)
    if vendor is None:
        raise HTTPException(400, "업체를 찾을 수 없습니다.")
    tickets.forward_to_vendor(db, t, vendor, datetime.now())
    return _detail(db, t)


@router.get("/statuses")
def statuses() -> list[str]:
    return TICKET_STATUSES


@router.get("/vendors")
def vendors(db: DB = Depends(get_db)):
    return [{"id": v.id, "name": v.name, "contact_name": v.contact_name, "phone": v.phone, "specialties": v.specialties}
            for v in tickets.list_vendors(db)]


@router.get("/notifications")
def notifications(db: DB = Depends(get_db)):
    return [_notification(n) for n in tickets.list_notifications(db)]


def _item_row(it: dict, score: float | None = None) -> dict:
    timing = sorted({c["시점"] for side in ("임대인부담", "임차인부담") for c in it[side] if c["시점"]})
    return {"id": it["id"], "zone": it["구역"], "path": cs.item_path(it), "label": cs.item_label(it),
            "landlord_text": it["임대인부담_원문"], "tenant_text": it["임차인부담_원문"], "timing": timing,
            "aliases": it["별칭"], "score": score}


@router.get("/cost-standard")
def cost_standard(q: str = "", limit: int = 30):
    """수선유지 기준 조회. 검색어가 있으면 search_policy() 결과, 없으면 전용부분 항목."""
    limit = max(1, min(limit, 100))
    if q.strip():
        hits = cs.search_policy(q, top_k=limit)
        cutoff = max(cs.MIN_SCORE / 2, hits[0]["score"] * 0.4) if hits else 0  # 관련도가 낮은 꼬리 결과는 숨긴다
        rows = [_item_row(h["item"], h["score"]) for h in hits if h["score"] >= cutoff]
    else:
        rows = [_item_row(it) for it in cs.load_items().values() if it["구역"] == "전용"][:limit]
    return {"source": "시설물 수선비 비용부담 기준(임대아파트 및 기타주택) 2026", "total": len(cs.load_items()), "rows": rows}


@router.get("/principles")
def principles():
    return [{"id": p["id"], "kind": p.get("구분"), "title": p.get("절") or p.get("용어") or "", "text": p["text"]}
            for p in cs.load_principles().values()]
