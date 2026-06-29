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
 * 출력: $MAKEEDU_OUT(기본 D:/tmp/makeedu)/<key>.json  = { key, scrapedAt, headers, rows:[[...cells]] }.
 *   ⚠️ 실 PII라 repo 밖(D:/tmp). rows는 [헤더→셀] 배열, 임포터가 헤더 substring으로 인덱싱.
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
const OUT = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";
const HEADED = !!process.env.HEADED;

// 학생은 엑셀(47컬럼)로 별도 확보 → 여기선 나머지 5 + (옵션)students DOM.
const LISTS = {
  classes: { url: "/lesson/lessonAllList.do" },
  prospects: { url: "/member/student/resList.do" },
  consultations: { url: "/counsel/counselList.do" },
  invoices: { url: "/pay/payUnionDeList.do" },
  catalog: { url: "/config/bookList.do" },
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
  if (/\/login\.do/i.test(page.url())) {
    throw new Error("로그인 실패(여전히 login.do) — ID/PW 또는 폼 셀렉터 확인.");
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

async function scrapeList(page, key, cfg) {
  await page.goto(`${BASE}${cfg.url}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(800);
  await maximizeListSize(page);

  let headers = [];
  const all = [];
  const seen = new Set();
  for (let p = 1; p <= 30; p++) {
    const { headers: h, rows } = await page.evaluate(EXTRACT);
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
    await page.waitForTimeout(700);
  }
  return { key, scrapedAt: new Date().toISOString(), headers, rows: all };
}

(async () => {
  const only = (process.argv.find((a) => a.startsWith("--list=")) || "").split("=")[1];
  const keys = only ? [only] : Object.keys(LISTS);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage();
  try {
    await login(page);
    console.log("login ok →", page.url().slice(0, 60));
    for (const key of keys) {
      const cfg = LISTS[key];
      if (!cfg) {
        console.error("unknown list:", key);
        continue;
      }
      const data = await scrapeList(page, key, cfg);
      fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(data));
      console.log(`  ✓ ${key}: ${data.rows.length} rows, ${data.headers.length} cols → ${key}.json`);
      console.log(`    headers: ${data.headers.filter(Boolean).join(" | ").slice(0, 160)}`);
    }
  } finally {
    await browser.close();
  }
  console.log("done →", OUT);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
