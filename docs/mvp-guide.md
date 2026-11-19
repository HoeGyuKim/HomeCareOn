# MVP 실행 가이드

README의 동작 흐름(전화 접수 AI → SH 직원 관리자 웹)을 텍스트·웹 마이크로 구현한 1차 MVP입니다.
세대·설비·업체 정보와 에러코드는 **목업**이고, 비용 부담 판정은 **실제 SH 기준 데이터**(`knowledge/cost_standard/`)를 씁니다.

## 실행 (Windows PowerShell)

저장소 루트(`C:\src\homecareon`)에서 실행합니다.

처음 한 번만:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

서버 실행:

```powershell
.venv\Scripts\python -m uvicorn backend.main:app --reload
```

| 주소 | 화면 |
|---|---|
| http://localhost:8000 | 거주자 음성 접수 (전화 대신 웹 마이크) |
| http://localhost:8000/admin/ | 관리자 웹 (SH 직원) |
| http://localhost:8000/docs | API 문서 (자동 생성) |

- 처음 실행하면 `backend/db.sqlite3`가 생기고 목업 세대 300개(101~105동, 1~15층, 층마다 4세대)와 업체 6곳이 들어갑니다. 초기화하려면 서버를 끄고 이 파일을 지우면 됩니다. (`.gitignore`에 이미 포함)
- DB 구조가 바뀐 코드를 받았는데 예전 `db.sqlite3`가 남아 있으면 서버가 "DB 구조가 코드와 다릅니다" 메시지를 내고 멈춥니다. 같은 방법으로 파일을 지우면 됩니다.
- 음성 입력·출력은 브라우저 내장 Web Speech API를 씁니다. Chrome 또는 Edge에서 마이크 권한을 허용하세요.
- 시연용 세대: `103동 1204호`(README 대화 예시, C사 보일러), `101동 202호`(A사 보일러), `105동 1501~1504호`(입주 1개월 이내).

### LLM 사용 (선택)

API 키가 없으면 규칙 기반 NLU로 동작합니다 (비용 0, 즉시 응답). Claude로 발화를 이해하게 하려면 서버를 켜기 전에 설정합니다.

```powershell
$env:ANTHROPIC_API_KEY = "본인 API 키"
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `NLU_MODE` | `auto` | `auto`(키가 있으면 LLM) / `rules`(항상 규칙) / `llm`(항상 LLM, 실패 시 규칙) |
| `LLM_MODEL` | `claude-opus-5-5` | 사용할 모델 |
| `LLM_EFFORT` | `low` | 추론 강도 (음성 응답 지연을 줄이려고 기본 `low`) |
| `DATABASE_URL` | `sqlite:///backend/db.sqlite3` | 다른 DB로 옮길 때 변경 |

LLM은 발화 이해(동호수·설비·증상·에러코드 추출, 접수 의사 판단)에만 씁니다. 비용 부담 판정과 티켓 생성은 LLM이 하지 않습니다.

### 테스트

```powershell
.venv\Scripts\python -m pytest
```

| 파일 | 내용 |
|---|---|
| `tests/test_engine.py` | README 대화 예시, 접수 거절, 동파(거주자 부담), 입주 1개월 판정, 세대 정정, 반복 실패·공용시설·가스 → 직원 확인 필요 |
| `tests/test_cost_standard.py` | 기준표 검색·판정 (실제 457개 항목) |
| `tests/test_nlu_rules.py` | 한글 숫자("백삼 동", "에러 공삼"), 접수 의사 판단 |
| `tests/test_api.py` | 접수 → 직원 일정 확정·문자 → 업체 전달 → 완료 |

테스트는 항상 규칙 기반으로 돌아서 API 키가 필요 없습니다.

## README 흐름과 코드 대응

| README | 코드 |
|---|---|
| 대화 단계: 세대 확인 → 증상 파악 → 비용 부담 안내 → 접수 의사 확인 → 마무리 | `backend/engine/engine.py` 상태머신 (`session.py`의 `State`) |
| 동호수·에러코드 숫자 정규화 ("백삼 동", "에러 공삼") | `backend/engine/korean_numbers.py`, `nlu_rules.py` |
| 세대·설비 DB 조회 | `backend/tools/households.py` (입주일·보일러 모델 포함) |
| `search_policy()` | `backend/knowledge/cost_standard.py` — 글자 2-gram TF-IDF 검색 |
| `decide_liability()` | `backend/knowledge/cost_standard.py` — 임대인/임차인 부담 원인, 입주 시점 단서, 부정 표현 처리 |
| 접수 희망 시 티켓 생성 (통화 요약 포함) | `backend/tools/tickets.py` `create_ticket()`, 요약은 `engine.build_summary()` |
| 판단이 어렵거나 반복 실패 → "직원 확인 필요" 티켓 | `engine._escalate()` (공용부분·기준에 없음·2회 실패·가스/화재) |
| 관리자 웹: 방문 일정 확정 → 문자 | `POST /api/admin/tickets/{id}/schedule`, 화면 `frontend/admin/` |
| 업체·기사 전달 | `POST /api/admin/tickets/{id}/forward` (전달 문구 미리보기 포함) |
| 상태 관리: 접수 → 일정 확정 → 처리 중 → 완료 | `PATCH /api/admin/tickets/{id}`, 최종 비용 부담 확정 포함 |

## 판정 방식 (`decide_liability`)

1. 거주자가 귀책 사유를 직접 말하면 (예: "얼어서", "부러뜨렸어요") 해당 항목의 임차인 부담 원인과 맞춰 **거주자 부담**.
   "동파는 아니고"처럼 부정한 절은 세지 않습니다.
2. 아니면 증상 유형(작동불량·누수·개폐불량 등)이 임대인 부담 원인에 있으면 **SH 부담**, 임차인 부담 원인이 있으면 "다만 ○○ 등으로 확인되면 거주자 부담 비용 발생 가능"을 함께 안내.
3. 임대인 부담이 `입주후1개월`·`입주시만` 단서로 묶여 있으면 세대 DB 입주일과 비교 (31일 이내 SH, 이후 거주자).
4. 원인에 따라 갈리면 **점검 후 결정**, 공용부분(P10)이나 기준에 없는 내용(P12)은 **직원 확인 필요**.

## 아직 남은 것

| 항목 | 현재 | 담당 (README 역할) |
|---|---|---|
| 검색 방식 | 2-gram TF-IDF (의존성 없음). 임베딩 RAG로 바꿀 때 `search_policy()`만 교체 | B |
| 검색 별칭 | MVP용 별칭 35줄을 `knowledge/mock/aliases_mvp.csv`에 따로 둠. 검수 후 `aliases.csv`로 옮기면 됨 | B |
| P11 천재지변 vs 표의 '동파' 우선순위 | 미반영 (cost_standard README의 팀 결정 사항) | B |
| 희망 방문 일정 수집 | 미구현. team_comment의 "문자 링크로 캘린더 선택" 안은 팀 결정 후 반영 | 팀 |
| 문자 실제 발송, 전화 회선 연동 | 목업 (발송 기록만 남김), 웹 마이크로 대체 | C / A |
| 서버 STT/TTS | 브라우저 Web Speech API 사용 중. README 기술 스택이 정해지면 `send()`/`speak()` 교체 | A |
| 관리자 로그인 | 없음. 외부에 공개하지 말 것 | C |
| 세대·설비·업체·에러코드 데이터 | 목업 | B / C |
