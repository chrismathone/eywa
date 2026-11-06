/**
 * scripts/_makeedu/import-monthly-enrolled.mjs — 메이크에듀 '월별입학퇴원통계'의 **재원생** 수를 원생 통계 '지난 기록'
 * (`student_history_monthly` 0385a · source='makeedu' · `enrolledRecord`)에 이어 넣는다(원장 2026-10-21 — 메이크에듀를 아직 쓰니
 * 2026-04부터 이번 달까지, 앞으로도 매달).
 *
 * 화면·표·읽는 칸: `monthly-enrolled.cjs` 머리 주석(화면 /member/monInOutReport.do · 머리 '재원생' 열 · 대조 결과).
 * 읽는 법: 로그인된 브라우저에서 그 화면의 검색과 같은 POST(검색 기준 '현재' · 기간 YYYY-MM ~ YYYY-MM)를 한 번 보내 HTML을 받는다.
 *   메이크에듀엔 **읽기만** 한다(검색 요청뿐 · 화면 설정·쿠키 저장도 안 바꾼다).
 * 쓰는 법: makeedu 줄의 data jsonb에 `enrolledRecord` 키만 더하거나 고친다(다른 키·aywa 줄은 손대지 않는다 · 없는 달은
 *   `{"enrolledRecord": N}` 새 줄) · 고친 줄만 computed_at 갱신. 판정 규칙 = `planEnrolledRecords`(넣을 달 앞 달들 — 요청은 앞 3달 · `--html`은 파일에 있는 앞 달 전부 — 을 DB와 대조해
 *   하나라도 다르면 전부 멈춤(확정 값 3달 이상) · 그 달이 끝나기 전에 쓴 '진행 중 값'·지난달·이번 달은 값이 바뀌면 고침 · 그 밖은 알리기만).
 *
 * 실행:
 *   node --env-file=.env.local scripts/_makeedu/import-monthly-enrolled.mjs                         # 드라이런(기본) · 지난달(진행 중 값으로 남은 더 앞 달이 있으면 그 달) ~ 이번 달
 *   node --env-file=.env.local scripts/_makeedu/import-monthly-enrolled.mjs --from 2026-04 --to 2026-10 --apply
 *   … --html <저장한 화면.html>   브라우저 없이 저장한 HTML로(오르카 내장 브라우저 등에서 받은 화면 · 검증·수동 적용용)
 *   … --overwrite                 지난달보다 앞 달의 다른 값도 고친다(메이크에듀가 지난 기록을 고쳤을 때만)
 * 세션: MAKEEDU_SESSION_FILE(기본 <repo>/.makeedu-tmp/session.json) → 없거나 만료면 MAKEEDU_ID/PW로 **1회** 로그인(재시도 안 함 —
 *   계정 잠금 방지 · 성공하면 세션을 저장해 다음 실행은 로그인하지 않는다). 규칙은 login-guard.cjs 한 벌 — makeedu가 사람 확인을
 *   요구하면(2026-11-06~) 자동 로그인 멈춤 표시를 남기고 멈춘다 → 연동 앱 'makeedu 다시 로그인'.
 *   MAKEEDU_BROWSER_CHANNEL=chrome이면 설치된 크롬으로 연다.
 * 끝 코드: 0 = 끝 · 1 = 오류(아무것도 안 씀) · 2 = 썼지만 사람이 볼 것이 남음(덮지 않은 다른 값 · 화면에 없는 달).
 * 지점: MAKEEDU_TENANT_ID(지점이 둘 이상이면 필수 — `resolveTenantId`).
 * ⚠️ 연동 앱(AywaSync)에서 돌릴 수 있게 SQL은 태그드 템플릿 한 문장씩만 쓴다(쓰기 묶음 없음). 연동 앱이 매달 부르려면
 *   남은 일이 있다 — docs/changelog.md 2026-10-21 '메이크에듀 재원생 기록 이어 받기' 줄.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import postgres from "postgres";

const require = createRequire(import.meta.url);
const L = require("./lib.cjs");
const G = require("./login-guard.cjs");
const { parseMonthlyEnrolledHtml, planEnrolledRecords, defaultFrom, addMonths, kstMonth, MONTH_RE } = require("./monthly-enrolled.cjs");

const BASE = "https://school.makeedu.co.kr";
const REPORT = "/member/monInOutReport.do";
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`✖ ${name} 뒤에 값이 없습니다`);
    process.exit(1);
  }
  return v;
};
const APPLY = argv.includes("--apply");
const OVERWRITE = argv.includes("--overwrite");
const HTML_FILE = arg("--html");
const THIS_MONTH = kstMonth();
const FROM_ARG = arg("--from");
const TO = arg("--to") ?? THIS_MONTH;
for (const m of [FROM_ARG, TO]) {
  if (m !== undefined && !MONTH_RE.test(m)) {
    console.error(`✖ 달은 YYYY-MM으로 적어 주세요: ${m}`);
    process.exit(1);
  }
}
const SESSION_FILE = G.defaultSessionFile(process.env);

/** 로그인된 브라우저에서 화면 검색과 같은 요청을 한 번 보내 HTML을 받는다. */
async function fetchReportHtml(checkFrom) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    ({ chromium } = await import("@playwright/test"));
  }
  const channel = process.env.MAKEEDU_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch({ headless: true, channel });
  try {
    // 로그인 한 벌(login-guard.cjs) — 저장 세션 → 자동 로그인 멈춤 표시 → ID/PW 한 번(재시도 없음 · 성공하면 세션 저장).
    const { page } = await G.openMakeeduContext(browser, { sessionFile: SESSION_FILE, log: (m) => console.log(m) });
    await page.goto(`${BASE}${REPORT}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // 화면의 '검색' 버튼이 보내는 폼과 같은 값(currentPage는 비우면 400) · baseType 1 = '현재'.
    const res = await page.evaluate(
      async ({ url, from, to }) => {
        const body = new URLSearchParams({ currentPage: "1", orderName: "", orderKind: "", status: "1", fromYmd: from, toYmd: to, baseType: "1", gType: "1", sumYn: "N", gradeYn: "N", ingStatus: "A" });
        const r = await fetch(url, { method: "POST", body, credentials: "include" });
        return { status: r.status, url: r.url, text: await r.text() };
      },
      { url: REPORT, from: checkFrom, to: TO },
    );
    if (res.status !== 200 || /login/i.test(res.url)) throw new Error(`월별입학퇴원통계 요청 실패(HTTP ${res.status})`);
    return res.text;
  } finally {
    await browser.close().catch(() => {});
  }
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const tenantId = await L.resolveTenantId(sql);
  const have = await sql`
    select to_char(month, 'YYYY-MM') as month, (data->>'enrolledRecord')::int as enrolled,
      to_char(computed_at at time zone 'Asia/Seoul', 'YYYY-MM') as written_in
    from student_history_monthly
    where tenant_id = ${tenantId} and source = 'makeedu' and data->>'enrolledRecord' is not null`;
  const existing = Object.fromEntries(have.map((r) => [r.month, { value: r.enrolled, writtenIn: r.written_in }]));
  const FROM = FROM_ARG ?? defaultFrom(existing, THIS_MONTH);
  if (FROM > TO) throw new Error(`넣을 달 범위가 잘못됐습니다: ${FROM} ~ ${TO}`);
  // 대조용 앞 3달(확정 값이 DB 값과 같아야 쓴다) — 메이크에듀 요청은 인자·DB 확인이 끝난 뒤에만 한다.
  const html = HTML_FILE ? fs.readFileSync(HTML_FILE, "utf8") : await fetchReportHtml(addMonths(FROM, -3));
  const scraped = parseMonthlyEnrolledHtml(html);
  const { checks, rows } = planEnrolledRecords({ scraped, existing, from: FROM, to: TO, thisMonth: THIS_MONTH, overwrite: OVERWRITE });

  console.log(`[메이크에듀 재원생 기록] ${APPLY ? "적용" : "드라이런"} · 넣을 달 ${FROM} ~ ${TO} · 지금 달 ${THIS_MONTH}${HTML_FILE ? " · 저장한 HTML" : ""}`);
  console.log(`  대조 ${checks.length}달 일치: ${checks.map((c) => `${c.month}=${c.db}`).join(" · ")}`);
  const LABEL = { insert: "새로 넣음", update: "고침", same: "그대로", confirm: "그대로 — 확정", conflict: "다름 — 안 고침(--overwrite)", empty: "메이크에듀 값 없음", missing: "화면에 없음" };
  for (const r of rows) {
    const detail = r.action === "update" || r.action === "conflict" ? `${r.before} → ${r.value}` : r.value ?? "";
    console.log(`  ${r.month}  ${String(detail).padEnd(12)} ${LABEL[r.action]}`);
  }
  const writes = rows.filter((r) => r.action === "insert" || r.action === "update" || r.action === "confirm");
  if (APPLY) {
    for (const r of writes) {
      await sql`
        insert into student_history_monthly (tenant_id, month, source, data, computed_at)
        values (${tenantId}, ${`${r.month}-01`}::date, 'makeedu', jsonb_build_object('enrolledRecord', ${r.value}::int), now())
        on conflict (tenant_id, month, source) do update
          set data = student_history_monthly.data || excluded.data, computed_at = now()`;
    }
    console.log(`  → ${writes.length}달 썼습니다`);
  } else {
    console.log(`  → 드라이런 — ${writes.length}달을 쓸 예정(--apply로 적용)`);
  }
  const missing = rows.filter((r) => r.action === "missing" && r.month < THIS_MONTH);
  if (missing.length) console.warn(`  ⚠️ 화면에 없는 달 ${missing.map((r) => r.month).join(", ")} — 메이크에듀가 기간을 잘라 준 것일 수 있습니다`);
  if (missing.length || rows.some((r) => r.action === "conflict")) process.exitCode = 2;
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
