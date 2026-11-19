from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from backend.main import create_app


def chat(c, *utterances):
    r = c.post("/api/chat/sessions").json()
    sid = r["session_id"]
    for u in utterances:
        res = c.post(f"/api/chat/sessions/{sid}/messages", json={"text": u})
        assert res.status_code == 200
        r = res.json()
    return r


def test_intake_then_staff_schedules_and_forwards(engine):
    with TestClient(create_app(engine)) as c:
        r = chat(c, "백삼 동 천이백사 호요", "보일러에 에러 공삼이 뜨고 온수가 안 나와요", "네, 접수해 주세요")
        assert r["state"] == "done" and r["outcome"] == "접수" and r["liability"]["payer"] == "SH"
        tid = r["ticket_id"]

        listed = c.get("/api/admin/tickets").json()
        assert listed[0]["id"] == tid and listed[0]["status"] == "접수" and listed[0]["visit_at"] is None

        d = c.get(f"/api/admin/tickets/{tid}").json()
        assert d["recommended_vendor_id"] and "개별보일러" in d["basis"]["item_path"]
        assert d["move_in_date"] and d["summary"].startswith("세대: 103동 1204호")
        assert d["notifications"] == []

        visit = (datetime.now() + timedelta(days=1)).replace(hour=14, minute=0, second=0, microsecond=0)
        d = c.post(f"/api/admin/tickets/{tid}/schedule",
                   json={"visit_at": visit.isoformat(), "vendor_id": d["recommended_vendor_id"]}).json()
        assert d["status"] == "일정 확정" and d["vendor_name"] == "한결보일러서비스"
        sms = d["notifications"][0]
        assert sms["kind"] == "방문 일정 안내" and "오후 2시로 확정" in sms["message"]

        d = c.post(f"/api/admin/tickets/{tid}/forward", json={"vendor_id": d["vendor_id"]}).json()
        assert d["forwarded"] and d["notifications"][0]["kind"] == "업체 전달"
        assert "103동 1204호" in d["forward_text"] and "에러 03(점화 불량)" in d["forward_text"]

        d = c.patch(f"/api/admin/tickets/{tid}", json={"status": "완료", "payer_final": "SH", "memo": "PCB 교체"}).json()
        assert (d["status"], d["payer_final"], d["memo"]) == ("완료", "SH", "PCB 교체")


def test_validation_and_reference_endpoints(engine):
    with TestClient(create_app(engine)) as c:
        assert c.post("/api/chat/sessions/nope/messages", json={"text": "hi"}).status_code == 404
        r = chat(c, "103동 1204호", "음", "고양이가 아파요")  # 직원 확인 필요 (세대는 확인됨)
        tid = r["ticket_id"]
        past = (datetime.now() - timedelta(days=1)).isoformat()
        assert c.post(f"/api/admin/tickets/{tid}/schedule", json={"visit_at": past}).status_code == 400
        assert c.post(f"/api/admin/tickets/{tid}/forward", json={"vendor_id": 999}).status_code == 400

        r = chat(c, "가스 냄새가 나요")  # 세대 확인 전 긴급 건
        future = (datetime.now() + timedelta(days=1)).isoformat()
        assert c.post(f"/api/admin/tickets/{r['ticket_id']}/schedule", json={"visit_at": future}).status_code == 400

        assert c.get("/api/admin/cost-standard", params={"q": "보일러 온수"}).json()["rows"][0]["id"].startswith("1-9-")
        assert len(c.get("/api/admin/principles").json()) == 40
        assert len(c.get("/api/admin/vendors").json()) == 6
        for page in ("/resident/", "/admin/", "/common/style.css"):
            assert c.get(page).status_code == 200
