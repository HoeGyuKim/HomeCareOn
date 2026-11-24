"""대화 엔진 API 서버 테스트."""
import pytest
from fastapi.testclient import TestClient

from backend import server
from backend.dialogue import tools


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(tools, "WEB_URL", "")
    monkeypatch.setattr(server, "load_api_key", lambda: None)
    return TestClient(server.app)


def test_call_flow(client):
    r = client.post("/api/dialogue/sessions").json()
    sid = r["session_id"]
    assert r["awaiting"] == "dongho" and r["engine"] == "rules"
    for text, awaiting in [
        ("103동 1204호 홍길동입니다", "issue"),
        ("보일러에서 온수가 안 나와요", "cause"),
        ("오래돼서 그런지 갑자기 안 돼요", "confirm"),
        ("네 접수해 주세요", "done"),
    ]:
        r = client.post(f"/api/dialogue/sessions/{sid}/messages", json={"text": text}).json()
        assert r["awaiting"] == awaiting, r["reply"]
    s = r["session"]
    assert s["liability_verdict"] == "SH_REPAIR" and s["ticket_id"]  # 웹 주소를 비워 임시 번호로 종료


def test_unknown_session(client):
    assert client.post("/api/dialogue/sessions/nope/messages", json={"text": "안녕"}).status_code == 404


def test_rag_endpoints(client):
    c = client.get("/api/rag/search", params={"q": "변기가 막혔어요"}).json()["candidates"]
    assert c[0]["id"] == "1-4-23"
    d = client.post("/api/rag/decide", json={"item_id": "1-4-23", "cause": "휴지를 많이 넣었어요"}).json()
    assert d["verdict"] == "TENANT_PAY" and d["defect_type"] == "LEAK_PIPE"
