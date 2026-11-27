"""HomeCareOn 한 번에 실행: 대화 엔진(FastAPI, 8100) + 관리자 웹(Next.js, 3000)

    Windows : .venv\\Scripts\\python run.py
    Mac     : .venv/bin/python run.py

    옵션  --reload   대화 엔진 코드를 고치면 자동으로 다시 시작

두 서버의 로그를 [엔진] / [웹] 으로 구분해 한 창에 보여 주고,
Ctrl+C 를 누르거나 한쪽이 꺼지면 다른 쪽도 함께 끈다.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "frontend" / "defect-care"
ENGINE_PORT = 8100
WEB_PORT = 3000
IS_WIN = os.name == "nt"

sys.stdout.reconfigure(errors="replace")  # 콘솔 인코딩에 없는 글자는 ? 로


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def check() -> list[str]:
    problems = []
    if not (WEB_DIR / "node_modules").exists():
        problems.append(f"웹 패키지가 설치되지 않았습니다 → cd {WEB_DIR.relative_to(ROOT)} 후 npm install")
    if not shutil.which("npm"):
        problems.append("npm 을 찾을 수 없습니다 (Node.js 설치 필요)")
    try:
        import uvicorn  # noqa: F401
    except ImportError:
        problems.append("uvicorn 이 없습니다 → 가상환경 python 으로 실행했는지 확인 (pip install -r requirements.txt)")
    for port, name in ((ENGINE_PORT, "대화 엔진"), (WEB_PORT, "웹")):
        if port_in_use(port):
            problems.append(f"{port} 포트를 이미 다른 프로그램이 쓰고 있습니다 ({name}용). 켜 둔 서버를 먼저 끄세요.")
    return problems


def start(name: str, cmd: list[str], cwd: Path, env: dict) -> subprocess.Popen:
    kw = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN else {"start_new_session": True}
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kw)

    def pump():
        for raw in iter(p.stdout.readline, b""):
            print(f"[{name}] {raw.decode('utf-8', 'replace').rstrip()}", flush=True)

    threading.Thread(target=pump, daemon=True).start()
    return p


def stop(p: subprocess.Popen) -> None:
    """프로세스와 그 자식(npm → node 등)까지 함께 끈다."""
    if p.poll() is not None:
        return
    if IS_WIN:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
    else:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.kill()


def main() -> int:
    ap = argparse.ArgumentParser(description="대화 엔진 + 관리자 웹 한 번에 실행")
    ap.add_argument("--reload", action="store_true", help="대화 엔진 코드 변경 시 자동 재시작")
    args = ap.parse_args()

    problems = check()
    if problems:
        print("실행할 수 없습니다:")
        for p in problems:
            print(f"  - {p}")
        return 1

    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    env.setdefault("DIALOGUE_API_URL", f"http://127.0.0.1:{ENGINE_PORT}")
    env.setdefault("HOMECAREON_WEB_URL", f"http://127.0.0.1:{WEB_PORT}")

    engine_cmd = [sys.executable, "-m", "uvicorn", "backend.server:app", "--port", str(ENGINE_PORT)]
    if args.reload:
        engine_cmd.append("--reload")
    procs = {
        "엔진": start("엔진", engine_cmd, ROOT, env),
        "웹": start("웹", [shutil.which("npm"), "run", "dev", "--", "-p", str(WEB_PORT)], WEB_DIR, env),
    }

    print(
        "\n  HomeCareOn 실행 중\n"
        f"    AI 전화 접수   http://localhost:{WEB_PORT}/call-simulator\n"
        f"    민원 접수 관리 http://localhost:{WEB_PORT}/complaints\n"
        f"    대화 엔진 API  http://localhost:{ENGINE_PORT}/docs\n"
        "  끄려면 Ctrl+C\n",
        flush=True,
    )

    try:
        while True:
            for name, p in procs.items():
                if p.poll() is not None:
                    print(f"\n[{name}] 서버가 종료되었습니다. 위 [{name}] 로그에서 원인을 확인하세요. 나머지도 끕니다.", flush=True)
                    return 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n종료하는 중…", flush=True)
        return 0
    finally:
        for p in procs.values():
            stop(p)
        print("모두 종료했습니다.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
