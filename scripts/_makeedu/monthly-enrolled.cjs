/**
 * scripts/_makeedu/monthly-enrolled.cjs — 메이크에듀 '월별입학퇴원통계'의 **재원생** 칸 읽기 + 쓸 줄 판정(순수 · 테스트).
 * 실행 파일은 import-monthly-enrolled.mjs. 여기는 HTML 문자열 → 달별 숫자, (읽은 값 · DB 값) → 쓸 줄만 한다.
 *
 * 화면: https://school.makeedu.co.kr/member/monInOutReport.do (원생 → 월별입학퇴원통계)
 * 표: 첫 `table.list` — 머리 `날짜 | 신규원생 | 휴원생 | 퇴원생 | 재원생`, 줄마다 `YYYY-MM | N 명 | … | N 명`, 맨 끝 `합계` 줄(평균).
 * 재원생 = 그 달에 메이크에듀가 남긴 재원생 수(상태가 재원인 원생 — 휴원·시작 전 포함). 값이 없는 달은 `-`.
 * 2026-10-21 대조: 2025-03 ~ 2026-03 13개 달이 DB `enrolledRecord`(10-20에 넣은 값)와 모두 같았고,
 * 검색 기준 '현재'(baseType=1)·'과거당시'(2) 어느 쪽이든 재원생 칸은 같았다(다른 칸만 달라진다).
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const textOf = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const cellsOf = (rowHtml, tag) => [...rowHtml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => textOf(m[1]));

/** `427 명` → 427 · `1,234 명` → 1234 · `-`·빈 칸 → null · 그 밖의 글자는 오류(다른 칸을 읽고 있다는 뜻). */
function parseCount(cell) {
  const t = String(cell ?? "").trim();
  if (t === "" || t === "-") return null;
  const m = t.match(/^([\d,]+)\s*명$/);
  if (!m) throw new Error(`재원생 칸을 숫자로 읽지 못했습니다: "${t.slice(0, 40)}"`);
  return Number(m[1].replace(/,/g, ""));
}

/**
 * 화면 HTML → `[{ month: "2026-04", enrolled: 427 }]`(값이 없는 달은 enrolled null).
 * 머리 칸 이름으로 '날짜'·'재원생' 열을 찾는다(자리 번호로 읽지 않는다 — 열이 늘어도 같은 칸).
 * 표를 못 찾거나 머리가 다르면 throw — 모르면 쓰지 않는다.
 */
function parseMonthlyEnrolledHtml(html) {
  const tables = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
  for (const table of tables) {
    const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
    if (!head) continue;
    const headers = cellsOf(head[1], "th");
    const dateCol = headers.indexOf("날짜");
    const enrolledCol = headers.indexOf("재원생");
    if (dateCol < 0 || enrolledCol < 0 || !headers.includes("신규원생")) continue;
    const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
    const out = [];
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = cellsOf(row[1], "td");
      const month = cells[dateCol];
      if (month === "합계") continue;
      if (!MONTH_RE.test(month ?? "")) throw new Error(`월별입학퇴원통계에 알 수 없는 줄이 있습니다: "${String(month).slice(0, 40)}"`);
      if (cells.length !== headers.length) throw new Error(`${month} 줄의 칸 수(${cells.length})가 머리(${headers.length})와 다릅니다`);
      out.push({ month, enrolled: parseCount(cells[enrolledCol]) });
    }
    if (!out.length) throw new Error("월별입학퇴원통계 표에 달 줄이 없습니다");
    return out;
  }
  throw new Error("월별입학퇴원통계 표(날짜·신규원생·재원생)를 찾지 못했습니다 — 로그인이 풀렸거나 화면이 바뀌었습니다");
}

/** `2026-10` 기준 n달 앞뒤. */
function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const kstMonth = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);

/**
 * 읽은 값과 DB 값 → 쓸 줄.
 *   scraped  = parseMonthlyEnrolledHtml 결과(대조 구간 + 넣을 구간)
 *   existing = { "2026-03": { value: 428, writtenIn: "2026-10" }, … } — DB makeedu 줄의 enrolledRecord와 그 줄을 쓴 달(computed_at · KST)
 *   from·to  = 넣을 달(포함) · thisMonth = 지금 달(KST)
 * '진행 중 값' = 그 달이 끝나기 전에 쓴 값(writtenIn <= month) — 그 뒤 메이크에듀 값이 바뀌는 게 정상이라 대조에 쓰지 않고, 다르면 고친다.
 * 규칙:
 *   ① 대조 — 넣을 구간 **앞** 달 중 DB에 확정 값이 있는 달은 메이크에듀 값과 같아야 한다. 하나라도 다르면 전부 멈춘다
 *      (다른 칸·다른 지점을 읽고 있다는 뜻). 맞는 달이 MIN_CHECKS보다 적으면 멈춘다(확인 없이 쓰지 않는다).
 *   ② 넣을 구간 — 지금 달 뒤는 넣지 않는다 · 메이크에듀 값이 없는 달(`-`)은 건너뛴다 · DB에 없으면 넣는다 ·
 *      같으면 그대로(지난 달의 진행 중 값이면 같은 값으로 다시 써서 확정 — `confirm`) · 다르면 **진행 중 값·지난달·이번 달**만 고친다(지난달은 달이 바뀐 직후 마지막 날 변동이 남을 수 있다).
 *      그 밖의 달이 다르면 덮지 않고 알린다(`--overwrite`일 때만 고친다).
 */
const MIN_CHECKS = 3;
const isProvisional = (month, entry) => entry.writtenIn !== undefined && entry.writtenIn <= month;

/** 기본 시작 달 = 지난달 — 그보다 앞에 진행 중 값으로 남은 달이 있으면 그 달부터(한 달을 건너뛰어도 확정값으로 고친다). */
function defaultFrom(existing, thisMonth) {
  let from = addMonths(thisMonth, -1);
  for (const [month, entry] of Object.entries(existing)) if (isProvisional(month, entry) && month < from) from = month;
  return from;
}

function planEnrolledRecords({ scraped, existing, from, to, thisMonth, overwrite = false }) {
  if (!MONTH_RE.test(from) || !MONTH_RE.test(to) || from > to) throw new Error(`넣을 달 범위가 잘못됐습니다: ${from} ~ ${to}`);
  const byMonth = new Map(scraped.map((r) => [r.month, r.enrolled]));
  const checks = [];
  for (const [month, entry] of Object.entries(existing)) {
    if (month >= from || !byMonth.has(month) || isProvisional(month, entry)) continue;
    checks.push({ month, db: entry.value, makeedu: byMonth.get(month) });
  }
  checks.sort((a, b) => a.month.localeCompare(b.month));
  const mismatched = checks.filter((c) => c.db !== c.makeedu);
  if (mismatched.length) {
    throw new Error(`대조 실패 — ${mismatched.map((c) => `${c.month} DB ${c.db} ↔ 메이크에듀 ${c.makeedu ?? "-"}`).join(", ")} · 다른 칸을 읽고 있을 수 있어 쓰지 않습니다`);
  }
  if (checks.length < MIN_CHECKS) {
    throw new Error(`대조할 달이 ${checks.length}달뿐입니다(${from} 앞 확정 값 ${MIN_CHECKS}달 이상 필요) — 같은 칸을 읽는지 확인할 수 없어 쓰지 않습니다`);
  }
  const settle = addMonths(thisMonth, -1);
  const rows = [];
  for (let month = from; month <= to && month <= thisMonth; month = addMonths(month, 1)) {
    const value = byMonth.has(month) ? byMonth.get(month) : undefined;
    const entry = existing[month];
    const before = entry?.value;
    if (value === undefined) { rows.push({ month, action: "missing", before }); continue; }
    if (value === null) { rows.push({ month, action: "empty", before }); continue; }
    if (!entry) rows.push({ month, action: "insert", value });
    // 지난 달의 진행 중 값이 확정값과 같으면 같은 값으로 한 번 더 써서 '확정'으로 굳힌다(안 그러면 영원히 진행 중으로 남아
    // 기본 시작 달이 계속 그 달로 당겨지고 대조에서도 빠진다).
    else if (before === value) rows.push({ month, action: month < thisMonth && isProvisional(month, entry) ? "confirm" : "same", value });
    else if (month >= settle || isProvisional(month, entry) || overwrite) rows.push({ month, action: "update", value, before });
    else rows.push({ month, action: "conflict", value, before });
  }
  return { checks, rows };
}

module.exports = { parseMonthlyEnrolledHtml, parseCount, planEnrolledRecords, defaultFrom, addMonths, kstMonth, MONTH_RE };
