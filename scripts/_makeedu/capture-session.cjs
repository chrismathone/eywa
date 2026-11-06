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
 * 📌 연동 PC는 이 스크립트 대신 AYWA 연동 앱 'makeedu 다시 로그인'(human-login.cjs — 로그인되면 저절로 저장·5분 제한)을 쓴다(2026-11-06).
 */
const G = require("./login-guard.cjs");

let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }

const BASE = G.BASE;
const OUT = G.defaultSessionFile(process.env);

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
  if (!G.isLoggedInUrl(url)) {
    // 로그인 안 된 상태로 저장하면 살아 있던 세션 파일을 덮어 지운다 — 저장하지 않는다(2026-11-06).
    console.warn(`⚠️ 현재 URL이 아직 로그인/재인증 페이지입니다(${url}). 저장하지 않았습니다 — 로그인 완료 후 다시 실행하세요.`);
    await browser.close();
    process.exit(1);
  }

  // 같은 파일 규칙(login-guard.cjs) — 원자 저장 · 로그인 시각 · 사람 확인 계열 멈춤만 지움(비밀번호·계정 계열은 계정을 다시 저장해야 풀린다).
  await G.saveSession(ctx, OUT);
  G.writeMeta(OUT, "capture");
  const kept = G.clearHumanBlock(OUT);
  if (kept) console.warn(`⚠️ 비밀번호·계정 확인 멈춤(${kept})은 남아 있습니다 — MAKEEDU_ID/PW를 다시 저장해야 자동 로그인이 풀립니다.`);
  console.log(`\n✅ 세션 저장됨 → ${OUT}`);
  console.log("   GitHub 시크릿 등록:");
  console.log(`     gh secret set MAKEEDU_STORAGE_STATE < "${OUT}"`);
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
