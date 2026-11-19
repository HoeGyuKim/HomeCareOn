"""세대·설비 조회 (README 도구 API: 세대 조회)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import COMPLEX_NAME
from ..models import Equipment, Household


def find_household(db: Session, dong: int, ho: int, complex_name: str = COMPLEX_NAME) -> Household | None:
    return db.scalar(
        select(Household).where(
            Household.complex == complex_name, Household.dong == dong, Household.ho == ho
        )
    )


def equipment_of(household: Household, kind: str) -> Equipment | None:
    return next((e for e in household.equipment if e.kind == kind), None)


def equipment_text(e: Equipment | None) -> str | None:
    return f"{e.kind} {e.manufacturer} {e.model} ({e.installed_year}년 설치)" if e else None
