// 거주자 음성 접수 화면 (전화 접수를 웹 마이크로 대체).
// 음성 인식(STT)·음성 합성(TTS)은 브라우저 내장 Web Speech API를 쓴다 (Chrome·Edge 권장, 비용 0).
// 서버 STT/TTS로 바꿀 때는 send(text) / speak(text)만 교체하면 된다.

const $ = (sel) => document.querySelector(sel);

const state = { sessionId: null, busy: false, listening: false, last: null };

const EXAMPLES = {
  household: ["백삼 동 천이백사 호요", "101동 202호 보일러가 안 켜지고 에러 11이 깜빡거려요", "105동 1502호예요"],
  symptom: [
    "보일러에 에러 공삼이 뜨고 온수가 안 나와요",
    "싱크대 아래에서 물이 새요",
    "초인종이 안 울려요",
    "아이가 놀다가 방문 손잡이를 부러뜨렸어요",
  ],
};

const PAYER_CLASS = { "SH": "info", "거주자": "warn", "점검 후 결정": "", "직원 확인 필요": "danger" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : res.statusText);
  return data;
}

function clock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------- 상담 내역
const SPEAKER = { ai: "AI 상담원", user: "민원인", sys: "시스템" };

function addLog(role, text, note) {
  const head = el("div", { class: "log-head" }, el("strong", {}, SPEAKER[role]), el("time", {}, clock()));
  if (note) head.append(el("span", {}, `· ${note}`));
  const item = el("div", { class: `log-item ${role}` }, head, el("p", { class: "log-body" }, text));
  $("#log").append(item);
  $("#log").scrollTop = $("#log").scrollHeight;
  return item;
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["#send", "#say-yes", "#say-no"]) $(id).disabled = busy;
  $("#pending")?.remove();
  if (busy) {
    const item = addLog("ai", "답변을 준비하고 있습니다…");
    item.id = "pending";
    item.classList.add("pending");
  }
}

async function startSession(speakGreeting) {
  stopSpeaking();
  $("#log").replaceChildren();
  const r = await api("/api/chat/sessions");
  state.sessionId = r.session_id;
  render(r, speakGreeting);
}

async function send(text) {
  text = text.trim();
  if (!text || state.busy || !state.sessionId) return;
  stopSpeaking();
  addLog("user", text);
  $("#input").value = "";
  setBusy(true);
  try {
    const r = await api(`/api/chat/sessions/${state.sessionId}/messages`, { text });
    setBusy(false);
    render(r, true);
  } catch (e) {
    setBusy(false);
    addLog("sys", `처리 중 오류가 발생했습니다. (${e.message})`);
  }
}

function nluNote(source) {
  if (source === "llm") return "LLM 이해";
  if (source === "rules") return "규칙 이해";
  return "";
}

function render(r, speakIt) {
  state.last = r;
  addLog("ai", r.reply, nluNote(r.nlu_source));
  if (speakIt) speak(r.reply);
  renderSteps(r);
  renderInfo(r);
  renderActions(r);
}

function renderSteps(r) {
  document.querySelectorAll("#steps li").forEach((li, i) => {
    const done = r.step === 3 || r.step > i;
    li.classList.toggle("done", done && !(r.step === 3 && i === 3));
    li.classList.toggle("on", r.step === i);
    if (r.step === i) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  $("#handoff").hidden = r.state !== "handoff";
}

function renderInfo(r) {
  const s = r.slots || {};
  $("#f-address").textContent = s.dong && s.ho ? `${s.dong}동 ${s.ho}호` : s.dong ? `${s.dong}동` : "-";
  $("#f-equipment").textContent = r.equipment || s.facility || "-";
  let symptom = s.symptom || "-";
  if (s.error_code) symptom += ` / 에러 ${s.error_code}${r.error_meaning ? `(${r.error_meaning})` : ""}`;
  $("#f-symptom").textContent = symptom;
  $("#f-ticket").textContent = r.ticket_id ? `제 ${r.ticket_id}호` : "-";

  const item = $("#f-item");
  const payer = $("#f-payer");
  item.replaceChildren();
  payer.replaceChildren();
  const l = r.liability;
  if (l) {
    if (l.item_label) {
      item.append(l.item_label, el("span", { class: "clause-txt" }, `SH 부담: ${l.landlord_text || "-"} / 거주자 부담: ${l.tenant_text || "-"}`));
    } else {
      item.textContent = "기준표에 해당 항목 없음";
    }
    payer.append(el("span", { class: `badge ${PAYER_CLASS[l.payer] ?? ""}` }, l.payer), " ",
      el("span", { class: "muted small" }, l.tenant_cost_possible && l.payer === "SH" ? "(거주자 비용 발생 가능)" : "(사전 안내)"));
  } else {
    item.textContent = "-";
    payer.textContent = "-";
  }
}

function renderActions(r) {
  $("#confirm-box").hidden = r.state !== "confirm";
  const note = $("#done-note");
  note.hidden = !(r.state === "done" || r.state === "handoff");
  if (r.state === "done") {
    note.textContent = r.outcome === "접수"
      ? `접수번호 ${r.ticket_id}번으로 접수되었습니다. 방문 일정은 담당 직원이 문자로 안내합니다.`
      : "접수하지 않고 안내만 받으셨습니다. 다시 접수하려면 [새로 접수]를 눌러 주십시오.";
  } else if (r.state === "handoff") {
    note.textContent = `담당 직원 확인 건으로 접수되었습니다${r.ticket_id ? ` (접수번호 ${r.ticket_id}번)` : ""}.`;
  }
  const items = EXAMPLES[r.state] || [];
  $("#examples").replaceChildren(...items.map((t) => el("button", { type: "button", onclick: () => send(t) }, t)));
  const ended = r.state === "done" || r.state === "handoff";
  $("#input").placeholder = ended ? "추가 접수는 [새로 접수] 버튼을 눌러 주십시오"
    : r.state === "household" ? "예) 103동 1204호요" : "예) 보일러에 에러 03이 뜨고 온수가 안 나와요";
}

// ---------------------------------------------------------------- 음성 합성 (TTS)
function speak(text) {
  if (!$("#speak").checked || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.05;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ko"));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// ---------------------------------------------------------------- 음성 인식 (STT)
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function setVoiceStatus(text, isError = false) {
  $("#voice-status").textContent = text;
  $("#voice-status").classList.toggle("error", isError);
}

function setListening(on) {
  state.listening = on;
  $("#mic").classList.toggle("listening", on);
  $("#mic-label").textContent = on ? "듣는 중 (누르면 종료)" : "음성으로 말하기";
  setVoiceStatus(on ? "말씀해 주십시오. 말씀이 끝나면 자동으로 전달됩니다." : "버튼을 누른 뒤 말씀하시면 자동으로 전달됩니다.");
}

function toggleMic() {
  if (state.listening) {
    recognizer?.stop();
    return;
  }
  stopSpeaking();
  recognizer = new Recognition();
  recognizer.lang = "ko-KR";
  recognizer.interimResults = true;
  let finalText = "";
  let errorMessage = "";

  recognizer.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    $("#input").value = finalText + interim;
  };
  recognizer.onerror = (e) => {
    errorMessage = e.error === "not-allowed" ? "마이크 권한이 필요합니다. 주소창의 마이크 아이콘에서 허용해 주십시오."
      : e.error === "no-speech" ? "음성이 감지되지 않았습니다. 다시 눌러 말씀해 주십시오."
      : `음성 인식 오류가 발생했습니다. (${e.error})`;
  };
  recognizer.onend = () => {
    setListening(false);
    if (errorMessage) setVoiceStatus(errorMessage, true);
    if (finalText.trim()) send(finalText);
  };
  recognizer.start();
  setListening(true);
}

// ---------------------------------------------------------------- 초기화
async function loadHealth() {
  try {
    const h = await (await fetch("/api/health")).json();
    $("#nlu-mode").textContent = h.nlu_mode === "llm" ? `상담 엔진: LLM (${h.llm_model})` : "상담 엔진: 규칙 기반";
  } catch {
    $("#nlu-mode").textContent = "서버 연결 안 됨";
  }
}

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  send($("#input").value);
});
$("#reset").addEventListener("click", () => startSession(true));
$("#speak").addEventListener("change", (e) => { if (!e.target.checked) stopSpeaking(); });
$("#say-yes").addEventListener("click", () => send("네, 접수해 주세요"));
$("#say-no").addEventListener("click", () => send("아니요, 안내만 들을게요"));

if (Recognition) {
  $("#mic").addEventListener("click", toggleMic);
} else {
  $("#mic").disabled = true;
  setVoiceStatus("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome·Edge를 이용하시거나 직접 입력해 주십시오.", true);
}

if ("speechSynthesis" in window) speechSynthesis.getVoices(); // 음성 목록 미리 로드

loadHealth();
startSession(false).catch((e) => addLog("sys", `서버에 연결할 수 없습니다. (${e.message})`));
