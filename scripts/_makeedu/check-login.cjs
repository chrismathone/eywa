/**
 * scripts/_makeedu/check-login.cjs — makeedu 로그인 스모크(읽기 전용).
 *
 * 이 PC가 makeedu **신뢰 IP**인지 확인한다(동기화 PC 지정 시 가장 중요한 검증 — 낯선 IP는 CAPTCHA로 막힘).
 * .env.local 의 MAKEEDU_ID/PW로 헤드리스 로그인 → main.do 도달이면 성공. 저장/쓰기 없음.
 *
 * 사용: node --env-file=.env.local scripts/_makeedu/check-login.cjs
 * exit 0 = 성공(신뢰 IP), exit 1 = 실패(크리덴셜/재인증벽/네트워크). setup-sync-pc.ps1이 게이트로 사용.
 */
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }
const BASE = "https://school.makeedu.co.kr";

(async () => {
  const id = process.env.MAKEEDU_ID, pw = process.env.MAKEEDU_PW;
  if (!id || !pw) { console.error("✖ MAKEEDU_ID / MAKEEDU_PW 가 .env.local 에 없습니다."); process.exit(1); }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE}/login.do`, { waitUntil: "domcontentloaded" });
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.waitFor({ timeout: 15000 });
    await page.locator('input[type="text"], input:not([type])').first().fill(id);
    await pwInput.fill(pw);
    await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), pwInput.press("Enter")]);
    await page.waitForTimeout(1500);
    const url = page.url();
    if (/loginReCert|reCert/i.test(url)) {
      console.error("✖ 재인증 벽(CAPTCHA) — 이 PC는 makeedu 신뢰 IP가 아닙니다. 기존 makeedu 사용 PC에서 실행하세요.");
      process.exit(1);
    }
    if (/login\.do/i.test(url)) {
      const hint = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 80));
      console.error(`✖ 로그인 실패 — 아이디/비밀번호 확인. (${hint})`);
      process.exit(1);
    }
    console.log(`✅ makeedu 로그인 성공 (신뢰 IP) — ${id} → ${url.slice(0, 45)}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error("✖ 로그인 확인 오류:", e.message); process.exit(1); });
