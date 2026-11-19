// HomeCareOn 관리자 웹 (SH 직원).
// README: 티켓 확인 → 방문 일정 확정·문자 안내 → 업체·기사 전달 → 상태 관리 (접수 → 일정 확정 → 처리 중 → 완료)

const $ = (sel) => document.querySelector(sel);

const STATUSES = ["접수", "직원 확인 필요", "일정 확정", "처리 중", "완료"];
const STATUS_CLASS = { "접수": "info", "직원 확인 필요": "danger", "일정 확정": "warn", "처리 중": "warn", "완료": "ok" };
const PAYER_CLASS = { "SH": "info", "거주자": "warn", "점검 후 결정": "", "직원 확인 필요": "danger" };

const VIEWS = {
  tickets: { menu: "민원관리", title: "접수 목록" },
  notifications: { menu: "민원관리", title: "문자·전달 이력" },
  standard: { menu: "기준정보", title: "비용부담 기준" },
  vendors: { menu: "기준정보", title: "업체 현황" },
};

const state = { tickets: [], vendors: [], search: { status: "", facility: "", address: "" }, selectedId: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

async function request(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : res.statusText);
  return data;
}

const pad = (n) => String(n).padStart(2, "0");

function fmt(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusBadge = (s) => el("span", { class: `badge ${STATUS_CLASS[s] ?? ""}` }, s);

function payerBadge(payer) {
  if (!payer) return "-";
  return el("span", { class: `badge ${PAYER_CLASS[payer] ?? ""}` }, payer);
}

function emptyRow(cols, text) {
  return el("tr", { class: "empty" }, el("td", { colspan: String(cols) }, text));
}

// ---------------------------------------------------------------- 화면 전환
function showView() {
  const view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "tickets";
  document.querySelectorAll("section[data-view]").forEach((s) => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll(".lnb a").forEach((a) => {
    const on = a.dataset.view === view;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const { menu, title } = VIEWS[view];
  $("#location").replaceChildren(el("span", {}, "홈"), el("span", {}, menu), el("strong", {}, title));
  $("#page-title").textContent = title;
  document.title = `${title} | HomeCareOn 관리자 웹`;
}

// ---------------------------------------------------------------- 접수 목록
function filtered() {
  const { status, facility, address } = state.search;
  const q = address.replace(/\s/g, "");
  return state.tickets.filter((t) =>
    (!status || t.status === status) &&
    (!facility || t.facility === facility) &&
    (!q || (t.address ?? "").replace(/\s/g, "").includes(q)));
}

async function loadTickets() {
  state.tickets = await request("/api/admin/tickets");
  renderSummary();
  renderRows();
  const d = new Date();
  $("#updated").textContent = `(최종 조회 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())})`;
}

function renderSummary() {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const t of state.tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const items = [["", "전체", state.tickets.length], ...STATUSES.map((s) => [s, s, counts[s]])];
  $("#summary").replaceChildren(
    ...items.map(([key, label, n]) =>
      el("button", {
        type: "button",
        class: state.search.status === key ? "on" : "",
        "aria-pressed": String(state.search.status === key),
        onclick: () => { state.search.status = key; $("#s-status").value = key; renderSummary(); renderRows(); },
      }, el("span", {}, label), el("b", {}, String(n))),
    ),
  );
}

function renderRows() {
  const rows = filtered();
  $("#total").textContent = String(rows.length);
  if (!rows.length) {
    const msg = state.tickets.length ? "조회 조건에 해당하는 접수 건이 없습니다." : "접수된 건이 없습니다. 거주자 접수 화면에서 접수해 보십시오.";
    $("#rows").replaceChildren(emptyRow(10, msg));
    return;
  }
  $("#rows").replaceChildren(
    ...rows.map((t) =>
      el("tr", {
        class: t.id === state.selectedId ? "selected" : "",
        tabindex: "0",
        onclick: () => select(t.id),
        onkeydown: (e) => { if (e.key === "Enter") select(t.id); },
      },
      el("td", { class: "num" }, String(t.id), t.urgent ? el("span", {}, " ", el("span", { class: "badge urgent" }, "긴급")) : null),
      el("td", { class: "num" }, fmt(t.created_at)),
      el("td", {}, t.address ?? "확인 필요"),
      el("td", {}, t.facility ?? "-"),
      el("td", { class: "left" }, (t.symptom ?? "-") + (t.error_code ? ` / 에러 ${t.error_code}` : "")),
      el("td", {}, payerBadge(t.payer_initial), t.tenant_cost_possible && t.payer_initial === "SH" ? el("div", { class: "muted small" }, "거주자 비용 가능") : null),
      el("td", {}, payerBadge(t.payer_final)),
      el("td", { class: "num" }, fmt(t.visit_at)),
      el("td", {}, t.vendor_name ?? "-", t.forwarded ? el("div", { class: "muted small" }, "전달 완료") : null),
      el("td", {}, statusBadge(t.status))),
    ),
  );
}

function downloadCsv() {
  const head = ["접수번호", "접수일시", "세대", "설비", "증상", "에러코드", "사전 부담 안내", "거주자 비용 가능", "확정 부담", "방문일시", "업체", "처리상태"];
  const lines = filtered().map((t) => [
    t.id, fmt(t.created_at), t.address, t.facility, t.symptom, t.error_code, t.payer_initial,
    t.tenant_cost_possible ? "Y" : "N", t.payer_final, t.visit_at ? fmt(t.visit_at) : "", t.vendor_name, t.status,
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const d = new Date();
  const a = el("a", { href: URL.createObjectURL(blob), download: `접수목록_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- 상세
async function select(id) {
  state.selectedId = id;
  renderRows();
  try {
    renderDetail(await request(`/api/admin/tickets/${id}`), true);
  } catch (e) {
    $("#detail").hidden = false;
    $("#detail").replaceChildren(el("p", { class: "point" }, `접수 건을 불러오지 못했습니다. (${e.message})`));
  }
}

const th = (text, attrs = {}) => el("th", { scope: "row", ...attrs }, text);
const td = (content, colspan) => el("td", colspan ? { colspan: String(colspan) } : {}, content ?? "-");
const row = (...cells) => el("tr", {}, ...cells);
const colgroup = () => el("colgroup", {}, el("col", { style: "width:150px" }), el("col", {}), el("col", { style: "width:150px" }), el("col", {}));
const formTable = (caption, ...rows) => el("table", { class: "tbl-form" }, el("caption", { class: "blind" }, caption), colgroup(), el("tbody", {}, ...rows));

function vendorSelect(id, selected, recommended) {
  return el("select", { id }, el("option", { value: "" }, "선택하세요"),
    ...state.vendors.map((v) => {
      const o = el("option", { value: String(v.id) }, `${v.name} (${v.specialties.length > 6 ? "종합" : v.specialties.join("·")})${v.id === recommended ? " · 추천" : ""}`);
      if (v.id === selected) o.selected = true;
      return o;
    }));
}

function timeSelect(id, selected) {
  const s = el("select", { id });
  for (let h = 9; h <= 18; h++) {
    for (const m of [0, 30]) {
      if (h === 18 && m === 30) continue;
      const v = `${pad(h)}:${pad(m)}`;
      const o = el("option", { value: v }, v);
      if (v === selected) o.selected = true;
      s.append(o);
    }
  }
  return s;
}

function messageSpan() {
  return el("span", { class: "saved", role: "status" });
}

async function act(msgEl, fn, okText) {
  try {
    const t = await fn();
    await loadTickets();
    renderDetail(t, false);
    const m = $(`#${msgEl}`);
    if (m) { m.className = "saved"; m.textContent = okText; }
  } catch (err) {
    const m = $(`#${msgEl}`);
    if (m) { m.className = "saved error"; m.textContent = err.message; }
  }
}

function renderDetail(t, scroll) {
  const b = t.basis || {};

  // 1) 접수 상세
  let symptom = t.symptom ?? "-";
  const basic = formTable("접수 기본 정보",
    row(th("접수번호"), td(String(t.id)), th("접수일시"), td(fmt(t.created_at))),
    row(th("세대"), td(t.address ?? "확인 필요"), th("거주자"), td(t.resident_name ? `${t.resident_name} (${t.resident_phone})` : null)),
    row(th("입주일"), td(t.move_in_date), th("설비 모델"), td(t.equipment)),
    row(th("증상"), td(symptom), th("에러코드"), td(t.error_code ? `${t.error_code}${t.error_meaning ? ` (${t.error_meaning})` : ""}` : null)),
    t.review_reason ? row(th("직원 확인 사유"), td(el("span", { class: "point" }, t.review_reason), 3)) : null,
  );

  // 2) 비용 부담 판단
  const basis = formTable("비용 부담 판단",
    row(th("사전 안내"), td(el("span", {}, payerBadge(t.payer_initial), t.tenant_cost_possible ? " 거주자 비용 발생 가능 안내함" : "")),
      th("판정 사유"), td(b.reason)),
    row(th("기준 항목"), td(t.item_id ? `${b.item_path} [${t.item_id}]` : "해당 항목 없음", 3)),
    row(th("임대인(SH) 부담"), td(b.landlord_text), th("임차인 부담"), td(b.tenant_text)),
    t.principles?.length ? row(th("적용 조항"), td(el("div", {}, ...t.principles.map((p) => el("div", { class: "small" }, `${p.id} ${p.text}`))), 3)) : null,
    row(th("출처"), td(b.source ?? "-", 3)),
  );

  // 3) 방문 일정 확정 → 문자
  const visit = t.visit_at ? new Date(t.visit_at) : null;
  const tomorrow = new Date(Date.now() + 86400000);
  const dateVal = visit ?? tomorrow;
  const dateInput = el("input", { type: "date", id: "d-date", min: new Date().toISOString().slice(0, 10) });
  dateInput.value = `${dateVal.getFullYear()}-${pad(dateVal.getMonth() + 1)}-${pad(dateVal.getDate())}`;
  const timeInput = timeSelect("d-time", visit ? `${pad(visit.getHours())}:${pad(visit.getMinutes())}` : "14:00");
  const schedVendor = vendorSelect("d-sched-vendor", t.vendor_id ?? t.recommended_vendor_id, t.recommended_vendor_id);
  const noHousehold = !t.address;
  const schedBtn = el("button", { type: "button", class: "btn btn-primary" }, t.visit_at ? "일정 변경 및 문자 재발송" : "일정 확정 및 문자 발송");
  if (noHousehold) schedBtn.disabled = true;
  schedBtn.addEventListener("click", () => act("msg-sched", () => request(`/api/admin/tickets/${t.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ visit_at: `${dateInput.value}T${timeInput.value}:00`, vendor_id: schedVendor.value ? Number(schedVendor.value) : null }),
  }), "방문 일정을 확정하고 거주자에게 문자를 보냈습니다. (목업)"));

  const schedule = formTable("방문 일정 확정",
    row(el("th", { scope: "row" }, el("label", { for: "d-date" }, "방문일시")), td(el("div", { class: "inline" }, dateInput, el("label", { for: "d-time", class: "blind" }, "시간"), timeInput)),
      el("th", { scope: "row" }, el("label", { for: "d-sched-vendor" }, "방문 업체")), td(schedVendor)),
    row(th("현재 일정"), td(t.visit_at ? el("span", { class: "done-txt" }, `${fmt(t.visit_at)} 확정 (문자 발송 ${fmt(t.scheduled_at)})`) : "미정", 3)),
  );

  // 4) 업체·기사 전달
  const fwdVendor = vendorSelect("d-fwd-vendor", t.vendor_id ?? t.recommended_vendor_id, t.recommended_vendor_id);
  const fwdBtn = el("button", { type: "button", class: "btn btn-primary" }, t.forwarded_at ? "다시 전달" : "업체에 전달");
  fwdBtn.addEventListener("click", () => {
    if (!fwdVendor.value) {
      const m = $("#msg-fwd");
      m.className = "saved error";
      m.textContent = "전달할 업체를 선택하십시오.";
      return;
    }
    act("msg-fwd", () => request(`/api/admin/tickets/${t.id}/forward`, {
      method: "POST", body: JSON.stringify({ vendor_id: Number(fwdVendor.value) }),
    }), "업체에 접수 내용을 전달했습니다. (목업)");
  });

  // 5) 상태 관리
  const statusSelect = el("select", { id: "d-status" }, ...STATUSES.map((s) => {
    const o = el("option", { value: s }, s);
    if (s === t.status) o.selected = true;
    return o;
  }));
  const payerSelect = el("select", { id: "d-payer" }, el("option", { value: "" }, "미확정"),
    ...["SH", "거주자"].map((p) => {
      const o = el("option", { value: p }, p);
      if (p === t.payer_final) o.selected = true;
      return o;
    }));
  const memo = el("textarea", { id: "d-memo", placeholder: "현장 점검 결과, 특이사항을 입력하십시오." });
  memo.value = t.memo ?? "";
  const saveBtn = el("button", { type: "button", class: "btn btn-primary" }, "저장");
  saveBtn.addEventListener("click", () => {
    const body = { status: statusSelect.value, memo: memo.value };
    if (payerSelect.value) body.payer_final = payerSelect.value;
    act("msg-save", () => request(`/api/admin/tickets/${t.id}`, { method: "PATCH", body: JSON.stringify(body) }), "저장되었습니다.");
  });
  const closeBtn = el("button", { type: "button", class: "btn" }, "닫기");
  closeBtn.addEventListener("click", () => { state.selectedId = null; $("#detail").hidden = true; renderRows(); });

  const manage = formTable("처리 상태 관리",
    row(el("th", { scope: "row" }, el("label", { for: "d-status" }, "처리상태")), td(statusSelect),
      el("th", { scope: "row" }, el("label", { for: "d-payer" }, "비용부담 확정")), td(payerSelect)),
    row(el("th", { scope: "row" }, el("label", { for: "d-memo" }, "처리 메모")), td(memo, 3)),
  );

  // 6) 발송 이력, 7) 상담 기록
  const sent = el("table", { class: "tbl" }, el("caption", { class: "blind" }, "이 접수 건의 발송 이력"),
    el("colgroup", {}, el("col", { style: "width:150px" }), el("col", { style: "width:110px" }), el("col", { style: "width:200px" }), el("col", {})),
    el("thead", {}, el("tr", {}, ...["발송일시", "구분", "수신", "내용"].map((h) => el("th", { scope: "col" }, h)))),
    el("tbody", {}, ...(t.notifications.length
      ? t.notifications.map((n) => el("tr", {}, el("td", { class: "num" }, fmt(n.created_at)), el("td", {}, n.kind),
          el("td", {}, `${n.to_name} (${n.to_phone})`), el("td", { class: "left" }, el("div", { class: "pre-box light" }, n.message))))
      : [emptyRow(4, "발송 이력이 없습니다.")])));

  const dialog = el("table", { class: "tbl dialog-tbl" }, el("caption", { class: "blind" }, "상담 기록"),
    el("colgroup", {}, el("col", { style: "width:70px" }), el("col", { style: "width:110px" }), el("col", {})),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "순번"), el("th", { scope: "col" }, "구분"), el("th", { scope: "col" }, "내용"))),
    el("tbody", {}, ...(t.transcript?.length
      ? t.transcript.map((m, i) => el("tr", { class: m.role }, el("td", {}, String(i + 1)),
          el("td", { class: "speaker" }, m.role === "user" ? "거주자" : "AI 상담원"), el("td", { class: "left" }, m.text)))
      : [emptyRow(3, "상담 기록이 없습니다.")])));

  const detail = $("#detail");
  detail.hidden = false;
  detail.replaceChildren(
    el("h3", { class: "h3" }, "접수 상세", el("span", { class: "sub" }, `접수번호 ${t.id}`), statusBadge(t.status), t.urgent ? el("span", { class: "badge urgent" }, "긴급") : null),
    basic,
    el("h3", { class: "h3" }, "비용 부담 판단", el("span", { class: "sub" }, "AI가 수선유지 기준표로 사전 안내한 내용입니다. 최종 부담은 현장 점검 후 확정하십시오.")),
    basis,
    el("h3", { class: "h3" }, "통화 요약"),
    el("pre", { class: "pre-box" }, t.summary || "-"),
    el("h3", { class: "h3" }, "방문 일정 확정", el("span", { class: "sub" }, "확정하면 거주자에게 방문 일정 문자가 발송됩니다.")),
    schedule,
    noHousehold ? el("p", { class: "help point" }, "세대가 확인되지 않은 건은 거주자와 통화해 세대를 확인한 뒤 일정을 잡으십시오.") : null,
    el("div", { class: "btn-area right" }, el("span", { id: "msg-sched", class: "saved", role: "status" }), schedBtn),
    el("h3", { class: "h3" }, "업체·기사 전달", el("span", { class: "sub" }, "아래 내용이 그대로 전달됩니다.")),
    el("pre", { class: "pre-box" }, t.forward_text),
    el("div", { class: "btn-area right" },
      el("span", { id: "msg-fwd", class: "saved", role: "status" }, t.forwarded_at ? `최근 전달 ${fmt(t.forwarded_at)}` : ""),
      el("label", { for: "d-fwd-vendor", class: "blind" }, "전달 업체"), fwdVendor, fwdBtn),
    el("h3", { class: "h3" }, "처리 상태 관리"),
    manage,
    el("div", { class: "btn-area right" }, el("span", { id: "msg-save", class: "saved", role: "status" }), closeBtn, saveBtn),
    el("h3", { class: "h3" }, "발송 이력"),
    el("div", { class: "tbl-wrap" }, sent),
    el("h3", { class: "h3" }, "상담 기록"),
    el("div", { class: "tbl-wrap" }, dialog),
  );
  if (scroll) detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------- 문자·전달 이력
async function loadNotifications() {
  const list = await request("/api/admin/notifications");
  $("#notification-rows").replaceChildren(
    ...(list.length
      ? list.map((n) => el("tr", {},
          el("td", {}, String(n.id)),
          el("td", { class: "num" }, fmt(n.created_at)),
          el("td", {}, n.ticket_id ? String(n.ticket_id) : "-"),
          el("td", {}, n.kind),
          el("td", {}, `${n.to_name}`, el("div", { class: "muted small" }, n.to_phone)),
          el("td", { class: "left" }, el("div", { class: "pre-box light" }, n.message))))
      : [emptyRow(6, "발송 이력이 없습니다.")]),
  );
}

// ---------------------------------------------------------------- 비용부담 기준
async function loadStandard(q = "") {
  const data = await request(`/api/admin/cost-standard?q=${encodeURIComponent(q)}&limit=40`);
  $("#standard-note").replaceChildren(`출처: ${data.source} (전체 ${data.total}개 항목). `,
    el("span", { class: "muted" }, "검색은 상담 엔진의 search_policy()와 같은 방식입니다."));
  $("#standard-count").textContent = q ? `"${q}" 검색 결과 ${data.rows.length}건 (관련도 순)` : `전용부분 항목 ${data.rows.length}건 표시`;
  $("#standard-rows").replaceChildren(
    ...(data.rows.length
      ? data.rows.map((r) => el("tr", {},
          el("td", { class: "num" }, r.id),
          el("td", {}, r.zone),
          el("td", { class: "left" }, el("b", {}, r.label), el("div", { class: "muted small" }, r.path),
            r.aliases.length ? el("div", { class: "muted small" }, `별칭: ${r.aliases.join(", ")}`) : null),
          el("td", { class: "left" }, r.landlord_text),
          el("td", { class: "left" }, r.tenant_text),
          el("td", {}, r.timing.join(", ") || "-")))
      : [emptyRow(6, "검색 결과가 없습니다.")]),
  );
}

async function loadPrinciples() {
  const list = await request("/api/admin/principles");
  $("#principle-rows").replaceChildren(...list.map((p) => el("tr", {},
    el("td", {}, p.id), el("td", {}, p.kind ?? "-"), el("td", { class: "left" }, p.title), el("td", { class: "left" }, p.text))));
}

// ---------------------------------------------------------------- 업체
async function loadVendors() {
  state.vendors = await request("/api/admin/vendors");
  $("#vendor-rows").replaceChildren(...state.vendors.map((v) => el("tr", {},
    el("td", {}, String(v.id)), el("td", {}, v.name), el("td", {}, v.contact_name),
    el("td", {}, v.specialties.length > 6 ? "종합 (전 분야)" : v.specialties.join(", ")), el("td", { class: "num" }, v.phone))));
}

// ---------------------------------------------------------------- 초기화
async function refresh() {
  try {
    await Promise.all([loadTickets(), loadNotifications()]);
  } catch (e) {
    $("#updated").textContent = `(서버 연결 실패: ${e.message})`;
  }
}

function tick() {
  const d = new Date();
  $("#clock").textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

$("#s-status").append(...STATUSES.map((s) => el("option", { value: s }, s)));
$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  state.search = { status: $("#s-status").value, facility: $("#s-facility").value, address: $("#s-address").value.trim() };
  renderSummary();
  renderRows();
});
$("#search-reset").addEventListener("click", () => {
  $("#search").reset();
  state.search = { status: "", facility: "", address: "" };
  renderSummary();
  renderRows();
});
$("#standard-search").addEventListener("submit", (e) => {
  e.preventDefault();
  loadStandard($("#q").value.trim());
});
$("#csv").addEventListener("click", downloadCsv);
window.addEventListener("hashchange", showView);

showView();
tick();
setInterval(tick, 30000);
loadVendors().then(refresh);
loadStandard();
loadPrinciples();
setInterval(refresh, 10000);
