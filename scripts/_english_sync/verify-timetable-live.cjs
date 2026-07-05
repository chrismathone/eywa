// 라이브 뷰 검증 — 마스터 로그인 후 /timetable(영어) 현재/과거 주 렌더 확인.
// 사용: EYWA_VERIFY_EMAIL/EYWA_VERIFY_PASSWORD env 필수 (자격증명 하드코딩 금지 — 2026-07-06 P0 픽스).
//   node --env-file=.env.local scripts/_english_sync/verify-timetable-live.cjs <port>
const { chromium } = require("@playwright/test");

const PORT = process.argv[2] || "3012";
const BASE = `http://localhost:${PORT}`;

const EMAIL = process.env.EYWA_VERIFY_EMAIL;
const PASSWORD = process.env.EYWA_VERIFY_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("EYWA_VERIFY_EMAIL / EYWA_VERIFY_PASSWORD env가 필요합니다 (마스터 계정).");
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(90_000);

  // 로그인 (클라이언트 signInWithPassword → router.push)
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60_000 });
  console.log("로그인 OK →", page.url());

  const summarize = async (label) => {
    const text = await page.evaluate(() => document.body.innerText);
    const has = (s) => text.includes(s);
    console.log(`\n=== ${label} ===`);
    console.log("  신규 반 노출: LT2:", has("LT2"), "| MEC1-3:", has("MEC1-3"), "| 고등E_고2 심화:", has("고등E_고2 심화"));
    console.log("  종강 반 노출: LT1:", has("LT1"), "| PJ2:", has("PJ2"), "| 고등특강(테스트):", has("고등특강(테스트)"));
    console.log("  강사 라벨: Elsa:", has("Elsa"), "| JJ:", /(^|\W)JJ(\W|$)/.test(text), "| 이주희:", has("이주희"), "| 부원장:", has("부원장"));
    console.log("  방 라벨: 본원305:", has("본원305"), "| 본원605:", has("본원605"), "| 본원SKY:", has("본원SKY"));
    return text;
  };

  // 현재 주 — 영어 기본뷰
  await page.goto(`${BASE}/timetable?subject=english`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await summarize("현재 주 · 영어 기본뷰");

  // 과거 주(6/22~28) — 옛 스케줄만, 신규 반 없어야
  await page.goto(`${BASE}/timetable?subject=english&week=2026-06-22`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await summarize("과거 주(6/22~28) · 영어 기본뷰");

  // 수학 무회귀 (200 + 렌더)
  const resp = await page.goto(`${BASE}/timetable?subject=math`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const mathText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log(`\n=== 수학 무회귀 === HTTP ${resp.status()} / 본문 시작: ${mathText.replace(/\n/g, " ").slice(0, 80)}`);

  await browser.close();
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
