/**
 * scripts/_makeedu/scrape.cjs — makeedu 라이브 스크래퍼 (Playwright 헤드리스).
 *
 * Chrome MCP가 대량 추출 불가(결과 잘림·블롭 다운로드 차단)라, node+Playwright가 직접 로그인→evaluate로
 * 전건을 받아 JSON 파일로 저장한다. 부트스트랩(Phase 1)과 증분 동기화(Phase 2 크롤러)가 공유할 추출 코어.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/scrape.cjs            # 6종 전부
 *   node --env-file=.env.local scripts/_makeedu/scrape.cjs --list=invoices
 *   HEADED=1 node --env-file=.env.local scripts/_makeedu/scrape.cjs   # 디버그(브라우저 보임)
 *
 * 필요: 저장 세션(MAKEEDU_SESSION_FILE · 'makeedu 다시 로그인'으로 받는다) 또는 .env.local 의 MAKEEDU_ID / MAKEEDU_PW
 *   (사용자가 입력 — 스크립트만 읽고, 사람은 안 봄). 로그인 규칙은 login-guard.cjs 한 벌(2026-11-06 사람 확인 대응).
 * 출력: $MAKEEDU_OUT(기본 <repo>/.makeedu-tmp)/<key>.json  = { key, scrapedAt, headers, rows:[[...cells]] }.
 *   ⚠️ 실 PII — repo 안 .makeedu-tmp(gitignore로 제외)에 저장. rows는 [헤더→셀] 배열, 임포터가 헤더 substring으로 인덱싱.
 */
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");
const G = require("./login-guard.cjs");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("@playwright/test"));
}

const BASE = "https://school.makeedu.co.kr";
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const HEADED = !!process.env.HEADED;

// 부트스트랩 때 학생은 엑셀(47컬럼)로 확보했지만, Phase 2 cron은 헤드리스라 엑셀 다운로드 대신
// **재원생 목록 DOM**을 긁는다(컬럼 적어도 증분엔 충분 — import-students-list.cjs가 header-driven으로 소비).
const LISTS = {
  classes: { url: "/lesson/lessonAllList.do" },
  prospects: { url: "/member/student/resList.do" },
  consultations: { url: "/counsel/counselList.do" },
  // ⚠️ 이 목록은 **검색 조건이 걸린 채로** 열린다 — 아래 prepareInvoices가 그 조건을 바로잡는다.
  invoices: { url: "/pay/payUnionDeList.do", prepare: prepareInvoices },
  catalog: { url: "/config/bookList.do" },
  // ⚠️ 재원생 목록 URL은 최초 실행에서 확인할 것. students.json이 0행이면 URL이 틀린 것 →
  //    MAKEEDU_STUDENTS_URL 환경변수로 정확한 경로를 덮어쓴다(코드 변경 없이 교정).
  students: { url: process.env.MAKEEDU_STUDENTS_URL || "/member/student/list.do" },
  // 퇴원생 관리(원장 확인 2026-07-30). makeedu는 실제 결제·환불을 처리하므로 **퇴원일이 aywa보다 정확**하다 —
  // aywa의 2026-07-10 일괄분(장부 날짜)을 교정·검증하는 근거로 쓴다(compare-withdrawal-dates.mjs).
  withdrawn: { url: process.env.MAKEEDU_WITHDRAWN_URL || "/member/student/stopList.do" },
  // 직원 출퇴근(원장 2026-10-15) — 강사평가 '강사 근태'. 지난달 1일 ~ 오늘 · 재직·퇴사 전부 · 출퇴근내역 보기.
  staff_attendance: { url: "/config/staffAttList.do", prepare: (page) => require("./staff-attendance.cjs").prepareStaffAttendance(page) },
};

// 페이지 내 실행: 가장 큰 테이블을 헤더+행배열로. 셀값 = select 선택값 > innerText > input.value.
// (No 셀은 hidden input 토큰이 있어도 innerText='1013'이 우선 → 안전. 금액 input은 innerText 비어 input.value.)
const { extractTable: EXTRACT } = require("./extract-table.cjs");

/**
 * 상세수납 목록의 **화면 표시 설정을 우리 브라우저에 심는다**(makeedu 서버 상태는 건드리지 않는다).
 *
 * 🔴 실측(2026-07-31): 이 설정들은 **쿠키**다 — `payUnionDeList_item_totalSum` · `payUnionDeList_listSize`.
 * 즉 **PC마다·브라우저마다 다르고**, Playwright는 매 실행 새 컨텍스트라 **항상 꺼진 채 시작**한다.
 * 사람이 자기 Chrome에서 켜 놔도 연동 PC 스크랩엔 아무 영향이 없다 → 스크래퍼가 스스로 심어야 한다.
 *
 * - `item_totalSum=Y` : 화면 하단 '결과 합계' 행. **외부 대조(makeedu 합계 ↔ aywa)의 전제**다.
 *   이게 없으면 검증이 안 서고, 검증이 없으면 삭제 판정이 보수 모드로 떨어져 유령이 쌓인다.
 * - `listSize=500`    : 페이지 크기. 셀렉트를 클릭해 바꾸면 **리로드가 한 번 더** 일어나 검색 조건과 서로를 흔든다
 *   (2026-07-31 수확 실패의 한 원인). 쿠키로 미리 정하면 그 상호작용 자체가 사라진다.
 *
 * ⚠️ 이건 **우리 헤드리스 브라우저의 쿠키**일 뿐이다. 화면설정 UI를 클릭하지 않으며, makeedu에 저장되는
 *    설정도 바꾸지 않는다(원장 지시: makeedu는 읽기만).
 */
async function applyDisplayCookies(ctx) {
  const domain = new URL(BASE).hostname;
  const cookies = [
    { name: "payUnionDeList_item_totalSum", value: "Y", domain, path: "/" },
    { name: "payUnionDeList_listSize", value: "500", domain, path: "/" },
  ];
  await ctx.addCookies(cookies).catch((e) => {
    // 실패해도 진행 — 합계가 없으면 '검증 안 함'으로 떨어질 뿐 동기화는 계속된다.
    console.warn(`  ⚠️ 화면설정 쿠키를 심지 못했습니다(${e.message}) — 외부 대조가 안 설 수 있습니다.`);
  });
}

// 페이지에 표시된 "총 N건"을 숫자로. 없으면 null(대조를 건너뛴다 — 모르면 경고하지 않는다).
async function readReportedTotal(page) {
  return page
    .evaluate(() => {
      const m = (document.body.innerText || "").match(/(?:총|전체)\s*([\d,]+)\s*건/);
      return m ? Number(m[1].replace(/,/g, "")) : null;
    })
    .catch(() => null);
}

/**
 * makeedu가 **스스로 말하는 합계**를 읽는다 — 화면 하단 '결과 합계' 행(원장이 설정에서 켠 표시).
 *
 * 🔑 이게 **외부 기준**이다. 지금까지의 대조는 `라인 → 집계 → 저장` 내부 3지점만 봐서 "우리끼리 일관됨"만
 * 증명했다. makeedu가 말하는 총액과 맞으면 비로소 **"makeedu와 같다"**를 증명할 수 있고,
 * 그게 되면 "부재"가 추측이 아니라 **사실**이 된다(= 삭제 판정 가드를 풀 근거).
 *
 * 형식(실측): `결과 합계 완납 1051건 152,675,775원 2,307,500원 0원 150,187,025원 0원`
 *             `미납 5건 818,250원 0원 0원 0원 818,250원`
 *             → 구분 · 건수 · 청구액 · 할인액 · 적립금 · 실제낸금액 · 미납금액
 *
 * ⚠️ 이 표시는 makeedu **설정**이라 꺼져 있을 수 있다 → 못 읽으면 **null**(모르면 검증했다고 하지 않는다).
 */
async function readReportedSummary(page) {
  return page
    .evaluate(() => {
      const RE = /(완납|미납)\s+([\d,]+)\s*건\s+([\d,]+)\s*원\s+([\d,]+)\s*원\s+([\d,]+)\s*원\s+([\d,]+)\s*원\s+([\d,]+)\s*원/;
      const n = (v) => Number(String(v).replace(/,/g, "")) || 0;
      const acc = { lines: 0, total: 0, discount: 0, points: 0, paid: 0, unpaid: 0 };
      const seen = new Set();
      let hit = 0;
      for (const tr of document.querySelectorAll("tr")) {
        const t = (tr.innerText || "").replace(/\s+/g, " ").trim();
        if (t.length > 240) continue;
        const m = RE.exec(t);
        if (!m || seen.has(m[0])) continue;
        seen.add(m[0]);
        hit++;
        acc.lines += n(m[2]); acc.total += n(m[3]); acc.discount += n(m[4]);
        acc.points += n(m[5]); acc.paid += n(m[6]); acc.unpaid += n(m[7]);
      }
      return hit ? acc : null;
    })
    .catch(() => null);
}

// 목록의 '조회/검색' 버튼만 눌러 검색을 다시 돌린다(저장·삭제류는 절대 건드리지 않는다).
async function clickSearch(page) {
  const btn = page.locator(
    'a:has-text("조회"), button:has-text("조회"), input[type="button"][value*="조회"], input[type="submit"][value*="조회"], ' +
      'a:has-text("검색"), button:has-text("검색"), input[type="button"][value*="검색"], input[type="submit"][value*="검색"]',
  );
  if ((await btn.count()) === 0) return false;
  await btn.first().click().catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  return true;
}

/**
 * 상세수납 목록의 **검색 조건을 바로잡는다**. 2026-07-30 프로브로 확인된 두 가지 기본값이
 * 동기화를 조용히 망가뜨리고 있었다.
 *
 * 🔴 ① `studStatus` 기본값이 **'1'(재원생만)** 이었다. 그래서 휴·퇴원생의 살아있는 청구가 목록에서
 *    아예 안 보였고, 임포터는 그걸 "makeedu에서 삭제됨"으로 읽었다 — 퇴원생에 대해서는 **삭제 판정의
 *    전제 자체가 틀렸다**(실측 855건 → 전체원생 857건). 전체('')로 바꾼다.
 * 🔴 ② `fromYm`/`toYm`이 **당월 한 달**이었다. 청구월이 넘어가면 직전 달이 그 뒤로 영원히 갱신되지 않는다
 *    (2026-07이 07-16에 동결돼 미수 ₩12.86M이 스냅샷으로 굳음). 범위로 넣으면 한 번에 여러 달을 받는다
 *    (실측 857건 → 3개월 3,174건). 개월 수는 MAKEEDU_INVOICE_MONTHS(기본 3).
 *
 * 실패해도 throw하지 않는다 — 조건을 못 바꿨으면 **예전과 같은 범위**로 진행될 뿐이라 동기화는 계속된다.
 * 다만 무엇이 적용됐는지는 반드시 로그에 남긴다(조용히 옛 동작으로 돌아가는 걸 허용하지 않는다).
 */
async function prepareInvoices(page) {
  const applied = [];
  const status = page.locator('select[name="studStatus"]');
  if ((await status.count()) > 0) {
    await status.selectOption("").catch(() => {});
    applied.push("원생상태=전체");
  }
  const months = Number(process.env.MAKEEDU_INVOICE_MONTHS || 3);
  // 🔴 범위 직접 지정(`MAKEEDU_INVOICE_FROM`/`TO`, `YYYY-MM`) — **묵은 미납 재대조** 전용 통로다.
  //    매일 도는 동기화는 최근 N개월만 보는데, 그 창 밖 청구는 최초 임포트 값에서 얼어붙는다.
  //    ⚠️ 이 통로로 범위를 넓히더라도 반영은 재대조 스크립트가 **대상 (학생,월)만** 한다
  //       (범위를 넓힌 채 전건을 반영하면 2026-07-31처럼 대량 오탐이 난다).
  const fixedFrom = /^\d{4}-\d{2}$/.test(process.env.MAKEEDU_INVOICE_FROM || "")
    ? process.env.MAKEEDU_INVOICE_FROM
    : null;
  const fixedTo = /^\d{4}-\d{2}$/.test(process.env.MAKEEDU_INVOICE_TO || "")
    ? process.env.MAKEEDU_INVOICE_TO
    : null;
  // 🔴 앵커는 **화면이 말하는 현재 청구월**이다 — 달력 월이 아니다. makeedu는 선청구라 달력 7월에
  //    이미 청구월이 2026-08이고, 달력으로 계산하면 정작 살아있는 달이 범위에서 빠진다(2026-07-31 사고).
  const anchor = await page.inputValue("#fromYm").catch(() => null);
  const auto = L.billingMonthRange({ anchor, months, today: new Date() });
  const from = fixedFrom || auto.from;
  const to = fixedTo || auto.to;
  if ((await page.locator("#fromYm").count()) > 0) {
    await page.fill("#fromYm", from).catch(() => {});
    await page.fill("#toYm", to).catch(() => {});
    applied.push(`청구월=${from}~${to}${anchor ? ` (현재 청구월 ${anchor})` : " (화면값 없음·달력 폴백)"}`);
  }
  if (!applied.length) {
    console.warn("    ⚠️ 수납 검색 조건을 못 찾았습니다(화면 개편 의심) — 기본 조건으로 진행합니다.");
    return;
  }
  const ok = await clickSearch(page);
  console.log(`    검색 조건: ${applied.join(" · ")}${ok ? "" : " (조회 버튼을 못 찾아 미적용)"}`);
}

async function maximizeListSize(page, cap) {
  const ls = page.locator('select[name="listSize"]');
  if ((await ls.count()) === 0) return;
  const vals = await page.$$eval('select[name="listSize"] option', (os) =>
    os.map((o) => o.value).filter((v) => /^\d+$/.test(v)).map(Number),
  );
  if (!vals.length) return;
  // cap이 있으면 그 이하 중 가장 큰 값 — 재수확 때 페이지를 가볍게 잡아 렌더를 따라가게 한다.
  const allowed = cap ? vals.filter((v) => v <= cap) : vals;
  const max = Math.max(...(allowed.length ? allowed : vals));
  await ls.selectOption(String(max)).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

// page.evaluate가 네비게이션 레이스("Execution context was destroyed")로 터지면 잠깐 정착 후 재시도.
async function safeEvaluate(page, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(fn);
    } catch (e) {
      if (attempt < 2 && /context was destroyed|destroyed|navigation/i.test(e.message || "")) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(800);
        continue;
      }
      throw e;
    }
  }
}

// 가장 큰 테이블의 tbody 행 수가 안정될 때까지 대기(AJAX 렌더·페이지크기 변경 후 정착) — 부분 로드 읽기 방지.
// ⚠️ 상한 8초는 **작은 표 기준**이었다. 3개월 × 페이지당 500행이면 렌더가 그 안에 안 끝나고,
//    부분 렌더된 표를 두 번 같은 수로 읽어 "정착"으로 오판한다(2026-07-31: 3,174건 중 130건만 수집).
async function waitForStableTable(page, maxWait = 30000) {
  const count = () =>
    safeEvaluate(page, () => {
      let max = 0;
      for (const t of document.querySelectorAll("table")) max = Math.max(max, t.querySelectorAll("tbody tr").length);
      return max;
    }).catch(() => 0);
  let last = -1,
    stable = 0;
  for (let t = 0; t < maxWait; t += 400) {
    const n = await count();
    if (n > 0 && n === last) {
      if (++stable >= 2) return n; // 2회 연속 동일 + >0 → 정착
    } else {
      stable = 0;
      last = n;
    }
    await page.waitForTimeout(400);
  }
  return last;
}

async function scrapeList(page, key, cfg) {
  await page.goto(`${BASE}${cfg.url}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  // ⚠️ 순서 주의: **페이지 크기를 먼저** 올리고, 그 다음 검색 조건을 넣어 **한 번의 조회**로 끝낸다.
  //    (반대로 하면 조회 뒤에 페이지크기 변경이 또 한 번 리로드를 일으켜 두 반영이 서로를 흔든다.)
  await maximizeListSize(page, cfg.pageSizeCap);
  // 준비가 돌려준 값(출퇴근 = 넣은 기간)은 결과에 `meta`로 싣는다 — 가져오기가 검색이 실제로 걸렸는지 확인한다.
  const meta = cfg.prepare ? await cfg.prepare(page) : undefined;
  await waitForStableTable(page);
  // 화면이 스스로 말하는 총건수 — 수집 결과와 대조해 **조용한 절단**을 잡는다(페이지 순회 중단·목록 개편).
  const totalReported = await readReportedTotal(page);
  const reportedSummary = await readReportedSummary(page); // makeedu가 말하는 합계(없으면 null)

  let headers = [];
  const all = [];
  const invoiceRefunds = {};
  const seen = new Set();
  for (let p = 1; p <= 30; p++) {
    const { headers: h, rows, invoiceRefunds: pageRefunds } = await safeEvaluate(page, EXTRACT);
    Object.assign(invoiceRefunds, pageRefunds);
    if (h.length) headers = h;
    let added = 0;
    for (const r of rows) {
      const k = r.join("");
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(r);
      added++;
    }
    // 다음 페이지(숫자 p+1) 링크 — 페이지네이션 영역 한정.
    const next = page
      .locator('.paging a, .pagination a, [class*="pag"] a, .page a')
      .filter({ hasText: new RegExp(`^\\s*${p + 1}\\s*$`) });
    // ⚠️ added===0 을 곧바로 "끝"으로 읽으면 **느리게 렌더된 페이지에서 조기 종료**한다(실측 3,174→130건).
    //    다음 페이지 링크가 아직 있다면 한 번 더 정착을 기다려 재추출한 뒤에 판단한다.
    if (added === 0 && (await next.count()) > 0) {
      await waitForStableTable(page);
      const retry = await safeEvaluate(page, EXTRACT);
      Object.assign(invoiceRefunds, retry.invoiceRefunds);
      for (const r of retry.rows) {
        const k = r.join("\u0001");
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(r);
        added++;
      }
    }
    if (added === 0 || (await next.count()) === 0) break;
    await next.first().click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await waitForStableTable(page); // 다음 페이지 정착 대기
  }
  return { key, scrapedAt: new Date().toISOString(), headers, rows: all, totalReported, reportedSummary, ...(meta ? { meta } : {}), ...(key === "invoices" ? { invoiceRefunds } : {}) };
}

/**
 * 목록 1개 수확. **덜 걷었으면 한 번 더**, 이번엔 페이지를 작게 나눠서 시도한다.
 *
 * 🔴 조용한 부족은 곧 **"makeedu에서 삭제됨" 오판**이 된다 — 못 받은 학생은 부재로 보이기 때문이다.
 * 그래서 부족은 로그 경고로 끝낼 일이 아니라 **재시도할 일**이다. 큰 페이지(500행)가 렌더를 못 따라가는 게
 * 실측 원인이라(3,174건 중 130건), 재시도는 페이지를 작게 잡는다(요청 수는 늘고 각 페이지는 가볍게).
 * ⚠️ **더 많이 걷은 쪽을 채택**한다 — 재시도가 더 나쁠 수도 있으므로 결과를 되돌리지 않는다.
 */
async function harvestList(page, key, cfg) {
  const first = await scrapeList(page, key, cfg);
  if (first.totalReported == null || first.rows.length >= first.totalReported) return first;
  console.warn(
    `    ↻ ${key} 재수확 — 화면 ${first.totalReported}건 중 ${first.rows.length}건만 받았습니다(페이지를 작게 나눠 재시도).`,
  );
  const second = await scrapeList(page, key, { ...cfg, pageSizeCap: 100 });
  return second.rows.length > first.rows.length ? second : first;
}

(async () => {
  // --list=invoices 또는 --list=students,classes,prospects,invoices (쉼표 다중). 없으면 전체.
  const only = (process.argv.find((a) => a.startsWith("--list=")) || "").split("=")[1];
  const keys = only ? only.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(LISTS);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    // 로그인 한 벌(login-guard.cjs) — ① 저장 세션(MAKEEDU_SESSION_FILE · 옛 MAKEEDU_STORAGE_STATE) → ② 자동 로그인 멈춤 표시 →
    // ③ ID/PW 한 번. 살아 있는 세션을 파일에 다시 저장해 두므로 sync-all의 뒤 단계(재원상담 증분 등)는 로그인하지 않는다.
    const { ctx, page } = await G.openMakeeduContext(browser, { log: (m) => console.log(m) });
    await applyDisplayCookies(ctx);
    for (const key of keys) {
      const cfg = LISTS[key];
      if (!cfg) {
        console.error("unknown list:", key);
        continue;
      }
      // 한 목록 실패(네비게이션 레이스·URL 오류 등)가 나머지를 막지 않게 격리 — 실패 목록은 0행으로 기록하고 계속.
      let data;
      try {
        data = await harvestList(page, key, cfg);
      } catch (e) {
        console.warn(`  ⚠️ ${key} 스크래핑 실패: ${e.message} — 건너뜀(0행)`);
        data = { key, scrapedAt: new Date().toISOString(), headers: [], rows: [], totalReported: null, reportedSummary: null, error: String(e.message || e).slice(0, 500) };
      }
      fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(data));
      console.log(`  ✓ ${key}: ${data.rows.length} rows, ${data.headers.length} cols → ${key}.json`);
      console.log(`    headers: ${data.headers.filter(Boolean).join(" | ").slice(0, 160)}`);
      if (data.reportedSummary)
        console.log(`    makeedu 합계: ${data.reportedSummary.lines}라인 · 청구 ${data.reportedSummary.total.toLocaleString("ko-KR")} · 미납 ${data.reportedSummary.unpaid.toLocaleString("ko-KR")}`);
      if (data.totalReported != null && data.totalReported !== data.rows.length) {
        // ⚠️ 부족(절단)과 초과(합계행 혼입·페이지 경계 중복)는 성격이 다르다 — 뭉뚱그려 "절단"이라고 하면
        //    사람이 엉뚱한 곳을 본다. 실제로 3459 vs 3481(초과 22)이 "절단 의심"으로 보고된 적이 있다.
        const d = data.rows.length - data.totalReported;
        console.warn(
          d < 0
            ? `    🔴 ${key} 절단 의심 — 화면 총 ${data.totalReported}건인데 ${data.rows.length}건만 수집(${-d}건 부족). 페이지 순회를 확인하세요.`
            : `    ⚠️ ${key} 초과 수집 — 화면 총 ${data.totalReported}건인데 ${data.rows.length}건 수집(${d}건 초과). 합계행 혼입·페이지 경계 중복 가능.`,
        );
      }
      if (data.rows.length === 0) {
        const hint = key === "students" ? " (URL 확인: MAKEEDU_STUDENTS_URL 환경변수로 교정)" : "";
        console.warn(`    ⚠️ ${key} 0행 — 목록 URL/로그인 세션을 확인하세요${hint}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log("done →", OUT);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
