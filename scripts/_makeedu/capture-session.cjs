/**
 * scripts/_makeedu/capture-session.cjs — makeedu 로그인 세션 캡처 (로컬, 헤드리스 아님).
 *
 * makeedu가 낯선 IP/헤드리스 로그인을 CAPTCHA(재인증)로 막으므로, **사람이 신뢰 IP의 실제 브라우저로 1회 로그인**한
 * 세션 쿠키(storageState)를 저장해 CI가 재사용한다(로그인 자체를 건너뛰어 CAPTCHA 회피).
 *
 * 사용(형님 PC 로컬):
 *   node scripts/_makeedu/capture-session.cjs
 *   → 브라우저가 열리면 직접 로그인(CAPTCHA·휴대폰 인증 통과) → 대시보드(main.do)가 보이면 이 터미널로 와 Enter
 *   → 세션 저장(기본 <repo>/.makeedu-tmp/session.json) → GitHub 시크릿 등록:
 *        gh secret set MAKEEDU_STORAGE_STATE < .makeedu-tmp/session.json
 * ⚠️ 세션은 만료될 수 있음 — 동기화가 "세션 무효/만료"로 실패하면 이 캡처를 다시 실행해 시크릿을 갱신.
 */
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }

const BASE = "https://school.makeedu.co.kr";
const OUT = process.env.MAKEEDU_SESSION_FILE || path.resolve(__dirname, "..", "..", ".makeedu-tmp", "session.json");

(async () => {
  const browser = await chromium.launch({ headless: false }); // 사람이 직접 보고 로그인
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login.do`, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("\n────────────────────────────────────────────────────────");
  console.log(" 열린 브라우저에서 makeedu에 직접 로그인하세요(CAPTCHA·휴대폰 인증 통과).");
  console.log(" 대시보드(main.do)가 보이면 이 터미널로 돌아와 Enter 를 누르세요.");
  console.log("────────────────────────────────────────────────────────\n");

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });

  const url = page.url();
  if (/login\.do|loginReCert\.do/i.test(url)) {
    console.warn(`⚠️ 현재 URL이 아직 로그인/재인증 페이지입니다(${url}). 로그인 완료 후 다시 실행하세요.`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await ctx.storageState({ path: OUT });
  console.log(`\n✅ 세션 저장됨 → ${OUT}`);
  console.log("   GitHub 시크릿 등록:");
  console.log(`     gh secret set MAKEEDU_STORAGE_STATE < "${OUT}"`);
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
