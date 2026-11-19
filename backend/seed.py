"""목업 데이터 생성. 실제 거주자·업체 정보가 아닌 가상 데이터다."""
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import COMPLEX_NAME
from .models import FACILITIES, Equipment, Household, Vendor

DONGS = [101, 102, 103, 104, 105]
FLOORS = range(1, 16)
UNITS = range(1, 5)
MANUFACTURERS = ["A사", "B사", "C사"]
SURNAMES = "김이박최정강조윤장임"
GIVEN = ["민준", "서연", "도윤", "지우", "하준", "서윤", "은우", "지민", "시우", "수아"]

VENDORS = [
    ("한결보일러서비스", "최보일", ["보일러"]),
    ("바른설비", "박배관", ["누수", "주방", "욕실"]),
    ("누리전기", "윤전기", ["전기"]),
    ("튼튼창호", "정창호", ["문·창호"]),
    ("안심가스", "강가스", ["가스"]),
    ("종합시설관리", "한설비", FACILITIES),
]

# 입주 1개월 이내 세대 (입주 시점 기준 판정 시연용)
RECENT_MOVE_IN = {(105, 1501), (105, 1502), (105, 1503), (105, 1504)}


def seed_if_empty(db: Session, today: date | None = None) -> None:
    if db.scalar(select(func.count()).select_from(Household)):
        return
    today = today or date.today()

    n = 0
    for dong in DONGS:
        for floor in FLOORS:
            for unit in UNITS:
                ho = floor * 100 + unit
                if (dong, ho) in RECENT_MOVE_IN:
                    move_in = today - timedelta(days=10 + unit)
                else:
                    move_in = date(2015 + n % 10, 1 + n % 12, 1 + n % 28)
                household = Household(
                    complex=COMPLEX_NAME,
                    dong=dong,
                    ho=ho,
                    resident_name=SURNAMES[n % 10] + GIVEN[(n * 7) % 10],
                    phone=f"010-0000-{n:04d}",
                    move_in_date=move_in,
                )
                maker = MANUFACTURERS[(dong + ho) % 3]
                year = 2014 + n % 9
                household.equipment.append(
                    Equipment(kind="보일러", manufacturer=maker, model=f"{maker[0]}-{year}", installed_year=year)
                )
                db.add(household)
                n += 1

    for i, (name, contact, specialties) in enumerate(VENDORS, start=1):
        db.add(Vendor(name=name, contact_name=contact, phone=f"010-0000-80{i:02d}", specialties=specialties))

    db.commit()
