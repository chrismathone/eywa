/**
 * scripts/_makeedu/staff-attendance.cjs — makeedu 직원 출퇴근(/config/staffAttList.do) → aywa `staff_attendance_days`(0365a)의 변환·판단.
 *
 * 원장 2026-10-15 *"https://school.makeedu.co.kr/config/staffAttList.do 에서 확인가능함"* → *"추천으로 진행"*.
 * makeedu는 **출근·퇴근 시각만** 남긴다(지각·결근 표시가 없다 — 이력 보기도 출근/퇴근 태그뿐). 그래서 여기서는 시각만 옮기고
 * 지각·조퇴·결근은 aywa가 점수를 매길 때 그날 수업 시각(또는 원장이 넣은 개인 출퇴근 시각)으로 판정한다(model/punctuality.ts).
 * 사진·태그 IP는 옮기지 않는다. 같은 줄은 makeedu 직원 번호(staffMno) + 날짜로 알아본다(다시 가져와도 겹치지 않는다).
 * 직원은 이름으로 잇는다(상담 등록자와 같은 규칙 — 동명이인·모르는 이름은 잇지 않는다).
 */
const L = require("./lib.cjs");
const { makeCounselorMatcher } = require("./consultation-counselor.cjs");

const kstToday = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 조회 기간 = 지난달 1일 ~ 오늘(한국 날짜) — 월초에도 지난달이 끝까지 채워지게. `from`/`to`(YYYY-MM-DD)를 주면 그 값(지난달 채우기). */
function staffAttendanceRange({ today, from, to } = {}) {
  const end = typeof today === "string" && YMD.test(today) ? today : kstToday(today instanceof Date ? today : new Date());
  const [y, m] = end.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const start = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const f = YMD.test(from || "") ? from : start;
  const t = YMD.test(to || "") ? to : end;
  if (f > t) throw new Error(`출퇴근 조회 기간이 거꾸로입니다(${f} ~ ${t})`);
  return { from: f, to: t };
}

/**
 * 직원 출퇴근 목록의 검색 조건(scrape.cjs가 부른다) — 기간(지난달 1일 ~ 오늘, `MAKEEDU_STAFF_ATT_FROM`/`TO`로 지난달 채우기) · 재직 상태 전체 ·
 * 출퇴근내역 보기. 🔴 검색은 **출퇴근 폼 안의 '검색' 링크**만 — 화면 위쪽에 이름·연락처 통합 검색이 있어 첫 '검색'을 누르면 엉뚱한 곳으로 간다.
 * 검색이 실제로 돌았는지(페이지가 다시 열렸는지 · 다시 열린 화면의 기간 칸이 넣은 값인지) 확인하고, 걸린 기간을 돌려준다
 * (스크랩 결과 `meta` → 가져오기가 모든 줄이 그 안인지 한 번 더 본다). 못 걸렸으면 멈춘다 — 엉뚱한 목록으로 지울 줄을 정하지 않게.
 */
async function prepareStaffAttendance(page) {
  const { from, to } = staffAttendanceRange({ from: process.env.MAKEEDU_STAFF_ATT_FROM, to: process.env.MAKEEDU_STAFF_ATT_TO });
  const form = page.locator('form[name="form"]');
  if ((await form.locator("#fromYmd").count()) === 0) throw new Error("출퇴근 목록의 기간 칸을 찾지 못했습니다(화면 개편 의심)");
  await page.fill("#fromYmd", from);
  await page.fill("#toYmd", to);
  await form.locator('select[name="ingYn"]').selectOption("").catch(() => {});
  await form.locator('select[name="viewType"]').selectOption("1").catch(() => {});
  const search = form.locator("a", { hasText: /^\s*검색\s*$/ });
  if ((await search.count()) === 0) throw new Error("출퇴근 목록의 검색 버튼을 찾지 못했습니다(화면 개편 의심)");
  // 검색은 폼 제출(페이지 다시 열림) — 표식을 남겨 두고, 클릭 뒤에도 남아 있으면 검색이 안 돈 것이다.
  await page.evaluate(() => { window.__staffAttBeforeSearch = true; });
  await search.first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ stale: Boolean(window.__staffAttBeforeSearch), from: document.querySelector("#fromYmd")?.value, to: document.querySelector("#toYmd")?.value }));
  if (after.stale) throw new Error("출퇴근 목록 검색이 돌지 않았습니다(페이지가 다시 열리지 않음)");
  if (after.from !== from || after.to !== to) throw new Error(`출퇴근 목록 기간이 걸리지 않았습니다(${after.from || "—"} ~ ${after.to || "—"})`);
  console.log(`    검색 조건: 기간=${from}~${to} · 재직 상태=전체 · 출퇴근내역`);
  return { from, to };
}

const REQUIRED = { name: "이름", day: "일자", checkIn: "출근 일시", checkOut: "퇴근 일시", memo: "메모", staffNo: "직원번호" };

/** 스크랩 결과(scrape.cjs) → 출퇴근 줄. 열 이름이 없거나 줄의 직원 번호를 못 읽으면 멈춘다(화면 개편 — 엉뚱한 칸을 읽거나 조용히 0건이 되지 않게). */
function parseStaffAttendance(data) {
  const headers = (data && data.headers) || [];
  const at = {};
  const missing = [];
  for (const [key, label] of Object.entries(REQUIRED)) {
    at[key] = headers.indexOf(label);
    if (at[key] < 0) missing.push(label);
  }
  if (missing.length) throw new Error(`출퇴근 목록의 열을 알아보지 못했습니다(없는 열: ${missing.join(", ")} · 읽은 열: ${headers.filter(Boolean).join(" | ").slice(0, 200)})`);
  const out = [];
  let noStaffNo = 0;
  for (const r of (data.rows || [])) {
    const day = L.parseDate(r[at.day]);
    const staffNo = L.txt(r[at.staffNo]);
    const name = L.txt(r[at.name]);
    if (!name) continue;
    // 이름은 있는데 날짜·직원 번호를 못 읽은 줄 — 건너뛰면 그날 기존 줄이 '지워진 줄'로 보여 지워진다. 멈춘다.
    if (!day || !staffNo) { noStaffNo++; continue; }
    const time = (v) => (/\d{1,2}:\d{2}/.test(L.txt(v) || "") ? L.parseTimestamp(v) : null);
    out.push({ staffNo, name, day, checkIn: time(r[at.checkIn]), checkOut: time(r[at.checkOut]), memo: (L.txt(r[at.memo]) || "").slice(0, 300) || null });
  }
  if (noStaffNo) throw new Error(`출퇴근 ${noStaffNo}줄의 날짜·직원 번호를 읽지 못했습니다(화면 개편 의심) — 쓰지 않습니다`);
  // 기간 안 기록이 0건이면 화면은 '데이터 없음' 안내 한 줄을 그린다(총 0건) — 그건 정상이다.
  if ((data.rows || []).length && !out.length && data.totalReported !== 0) throw new Error("출퇴근 목록을 받았지만 한 줄도 읽지 못했습니다(화면 개편 의심) — 쓰지 않습니다");
  return out;
}

const ms = (v) => (v == null ? null : new Date(v).getTime());
const earlier = (a, b) => (!a ? b : !b ? a : ms(a) <= ms(b) ? a : b);
const later = (a, b) => (!a ? b : !b ? a : ms(a) >= ms(b) ? a : b);

/**
 * 줄 → 쓸 줄(새 줄·바뀐 줄) · 지울 줄(그 기간에 aywa엔 있는데 makeedu에서 지워졌거나 시각이 비워진 줄).
 * 같은 직원 번호·날짜가 둘이면 가장 이른 출근 · 가장 늦은 퇴근으로 합친다.
 * 이름을 못 잇거나(모르는 이름) 동명이인이면 쓰지 않고 센다 — 남의 출퇴근을 붙이느니 비워 둔다. 퇴사자까지 받으므로, 한 직원에
 * 서로 다른 makeedu 직원 번호가 둘 이상 이어지면(퇴사한 동명이인이 재직자에게 붙는 경우) 그 직원 줄은 전부 건너뛴다.
 */
function planStaffAttendance({ rows, users, existing, tenantId }) {
  const match = makeCounselorMatcher(users);
  const merged = new Map();
  for (const r of rows) {
    const key = `${r.staffNo}|${r.day}`;
    const was = merged.get(key);
    merged.set(key, was ? { ...was, checkIn: earlier(was.checkIn, r.checkIn), checkOut: later(was.checkOut, r.checkOut), memo: was.memo || r.memo } : r);
  }
  const userOf = new Map();
  const staffNosOf = new Map();
  for (const r of merged.values()) {
    if (!userOf.has(r.staffNo)) userOf.set(r.staffNo, match(r.name) || null);
    const user = userOf.get(r.staffNo);
    if (user) (staffNosOf.get(user.id) ?? staffNosOf.set(user.id, new Set()).get(user.id)).add(r.staffNo);
  }
  const before = new Map((existing || []).map((e) => [e.source_key, e]));
  const writes = [], keep = new Set();
  let unmatched = 0, ambiguous = 0, unchanged = 0, empty = 0;
  for (const [key, r] of merged) {
    if (!r.checkIn && !r.checkOut) { empty++; continue; }
    const user = userOf.get(r.staffNo);
    if (!user) { unmatched++; keep.add(key); continue; }
    // 모호해진 줄은 남겨 두지 않는다(전에 한 사람에게 붙었던 줄이 남의 것일 수 있다).
    if (staffNosOf.get(user.id).size > 1) { ambiguous++; continue; }
    keep.add(key);
    const row = {
      tenant_id: tenantId, user_id: user.id, work_date: r.day, check_in_at: r.checkIn, check_out_at: r.checkOut,
      status: "present", late_minutes: null, source: "makeedu", source_key: key, note: r.memo,
    };
    const e = before.get(key);
    if (e && e.user_id === row.user_id && String(e.work_date).slice(0, 10) === row.work_date && ms(e.check_in_at) === ms(row.check_in_at)
      && ms(e.check_out_at) === ms(row.check_out_at) && (e.note || null) === row.note) { unchanged++; continue; }
    writes.push(row);
  }
  const deletes = [...before.keys()].filter((k) => !keep.has(k));
  return { writes, deletes, unmatched, ambiguous, unchanged, empty, merged: merged.size };
}

module.exports = { staffAttendanceRange, prepareStaffAttendance, parseStaffAttendance, planStaffAttendance, STAFF_ATTENDANCE_HEADERS: REQUIRED };
