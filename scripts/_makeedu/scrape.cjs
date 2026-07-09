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
 * 필요: .env.local 에 MAKEEDU_ID / MAKEEDU_PW (사용자가 입력 — 스크립트만 읽고, 사람은 안 봄).
 * 출력: $MAKEEDU_OUT(기본 <repo>/.makeedu-tmp)/<key>.json  = { key, scrapedAt, headers, rows:[[...cells]] }.
 *   ⚠️ 실 PII — repo 안 .makeedu-tmp(gitignore로 제외)에 저장. rows는 [헤더→셀] 배열, 임포터가 헤더 substring으로 인덱싱.
 */
const fs = require("fs");
const path = require("path");

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
  invoices: { url: "/pay/payUnionDeList.do" },
  catalog: { url: "/config/bookList.do" },
  // ⚠️ 재원생 목록 URL은 최초 실행에서 확인할 것. students.json이 0행이면 URL이 틀린 것 →
  //    MAKEEDU_STUDENTS_URL 환경변수로 정확한 경로를 덮어쓴다(코드 변경 없이 교정).
  students: { url: process.env.MAKEEDU_STUDENTS_URL || "/member/student/list.do" },
};

// 페이지 내 실행: 가장 큰 테이블을 헤더+행배열로. 셀값 = select 선택값 > innerText > input.value.
// (No 셀은 hidden input 토큰이 있어도 innerText='1013'이 우선 → 안전. 금액 input은 innerText 비어 input.value.)
function EXTRACT() {
  const tables = Array.from(document.querySelectorAll("table"));
  let best = null,
    br = 0;
  for (const t of tables) {
    const r = t.querySelectorAll("tbody tr").length;
    if (r > br) {
      br = r;
      best = t;
    }
  }
  if (!best) return { headers: [], rows: [] };
  const headers = Array.from(best.querySelectorAll("thead th, thead td")).map((h) =>
    (h.textContent || "").replace(/\s+/g, " ").trim(),
  );
  const rows = [];
  for (const tr of best.querySelectorAll("tbody tr")) {
    const cells = Array.from(tr.children).map((td) => {
      const sel = td.querySelector("select");
      if (sel) return (sel.options[sel.selectedIndex]?.text || "").trim();
      let v = (td.innerText || "").replace(/\s+/g, " ").trim();
      if (!v) {
        const inp = td.querySelector("input");
        if (inp) v = (inp.value || "").trim();
      }
      return v;
    });
    rows.push(cells);
  }
  return { headers, rows };
}

async function login(page) {
  const id = process.env.MAKEEDU_ID;
  const pw = process.env.MAKEEDU_PW;
  if (!id || !pw) throw new Error("MAKEEDU_ID / MAKEEDU_PW 가 .env.local 에 없습니다.");
  await page.goto(`${BASE}/login.do`, { waitUntil: "domcontentloaded" });
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ timeout: 15000 });
  // ID = password 앞의 첫 text/무타입 input.
  const idInput = page.locator('input[type="text"], input:not([type])').first();
  await idInput.fill(id);
  await pwInput.fill(pw);
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    pwInput.press("Enter"),
  ]);
  await page.waitForTimeout(1500);
  const url = page.url();
  if (/\/login\.do/i.test(url)) {
    throw new Error("로그인 실패(여전히 login.do) — ID/PW 또는 폼 셀렉터 확인.");
  }
  // makeedu는 낯선 IP·헤드리스 새 로그인을 재인증(CAPTCHA+휴대폰)으로 막는다. 그 페이지에 떨어지면 명확히 실패.
  if (/loginReCert\.do|reCert/i.test(url)) {
    throw new Error(
      "makeedu 재인증 벽(loginReCert.do) — CAPTCHA+휴대폰 인증 필요. 헤드리스/낯선 IP 새 로그인은 못 뚫는다. " +
        "capture-session.cjs로 세션을 캡처해 MAKEEDU_STORAGE_STATE로 재사용하거나, 신뢰 IP(로컬/셀프호스티드)에서 실행하세요.",
    );
  }
}

async function maximizeListSize(page) {
  const ls = page.locator('select[name="listSize"]');
  if ((await ls.count()) === 0) return;
  const vals = await page.$$eval('select[name="listSize"] option', (os) =>
    os.map((o) => o.value).filter((v) => /^\d+$/.test(v)).map(Number),
  );
  if (!vals.length) return;
  const max = Math.max(...vals);
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
async function waitForStableTable(page, maxWait = 8000) {
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
  await maximizeListSize(page);
  await waitForStableTable(page); // 페이지크기 최대화 후 테이블 정착 대기

  let headers = [];
  const all = [];
  const seen = new Set();
  for (let p = 1; p <= 30; p++) {
    const { headers: h, rows } = await safeEvaluate(page, EXTRACT);
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
    if (added === 0 || (await next.count()) === 0) break;
    await next.first().click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await waitForStableTable(page); // 다음 페이지 정착 대기
  }
  return { key, scrapedAt: new Date().toISOString(), headers, rows: all };
}

(async () => {
  // --list=invoices 또는 --list=students,classes,prospects,invoices (쉼표 다중). 없으면 전체.
  const only = (process.argv.find((a) => a.startsWith("--list=")) || "").split("=")[1];
  const keys = only ? only.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(LISTS);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: !HEADED });
  // 세션 재사용 — MAKEEDU_STORAGE_STATE(capture-session.cjs로 캡처한 storageState JSON)가 있으면 로그인을 건너뛴다.
  // makeedu가 낯선 IP/헤드리스 새 로그인을 CAPTCHA로 막으므로, 신뢰 IP에서 캡처한 세션을 들고 바로 접근(CAPTCHA 회피).
  let storage = null;
  if (process.env.MAKEEDU_STORAGE_STATE) {
    try {
      storage = JSON.parse(process.env.MAKEEDU_STORAGE_STATE);
    } catch {
      throw new Error("MAKEEDU_STORAGE_STATE 파싱 실패 — capture-session.cjs로 다시 캡처해 시크릿을 갱신하세요.");
    }
  }
  const ctx = storage
    ? await browser.newContext({ storageState: storage })
    : await browser.newContext();
  const page = await ctx.newPage();
  try {
    if (storage) {
      // 로그인 건너뜀 — main.do로 세션 유효성만 확인(만료/IP거부면 로그인·재인증으로 튕긴다).
      await page.goto(`${BASE}/main.do`, { waitUntil: "domcontentloaded" }).catch(() => {});
      if (/login\.do|loginReCert\.do/i.test(page.url())) {
        throw new Error(
          "저장된 세션이 무효/만료됐거나 IP에서 거부됨(main.do→로그인 리다이렉트). capture-session.cjs로 재캡처해 " +
            "MAKEEDU_STORAGE_STATE를 갱신하세요. 재캡처해도 GitHub에서만 실패하면 세션이 IP에 묶인 것 → 로컬/셀프호스티드 실행 필요.",
        );
      }
      console.log("session reuse ok →", page.url().slice(0, 60));
    } else {
      await login(page);
      console.log("login ok →", page.url().slice(0, 60));
    }
    for (const key of keys) {
      const cfg = LISTS[key];
      if (!cfg) {
        console.error("unknown list:", key);
        continue;
      }
      // 한 목록 실패(네비게이션 레이스·URL 오류 등)가 나머지를 막지 않게 격리 — 실패 목록은 0행으로 기록하고 계속.
      let data;
      try {
        data = await scrapeList(page, key, cfg);
      } catch (e) {
        console.warn(`  ⚠️ ${key} 스크래핑 실패: ${e.message} — 건너뜀(0행)`);
        data = { key, scrapedAt: new Date().toISOString(), headers: [], rows: [] };
      }
      fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(data));
      console.log(`  ✓ ${key}: ${data.rows.length} rows, ${data.headers.length} cols → ${key}.json`);
      console.log(`    headers: ${data.headers.filter(Boolean).join(" | ").slice(0, 160)}`);
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
