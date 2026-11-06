/**
 * scripts/_makeedu/check-login.cjs — makeedu 접속 스모크(읽기 전용 · DB 없음).
 *
 * 동기화 PC 지정 때 "이 PC에서 makeedu에 들어가지는가"를 본다(setup-sync-pc.ps1 게이트).
 * 로그인 규칙은 login-guard.cjs 한 벌이다 — 저장 세션이 살아 있으면 그걸로 끝(로그인 0회) · 없으면 자동 로그인 멈춤 표시를
 * 확인하고 · ID/PW로 **한 번만** 로그인한다(성공하면 세션 저장 · OK가 아니면 멈춤 표시). 2026-11-06부터 makeedu가 자동 로그인에
 * 사람 확인을 요구하면 여기서도 그 사유로 실패한다 → 연동 앱 'makeedu 다시 로그인'(또는 human-login.cjs)으로 사람이 한 번 확인.
 *
 * 사용: node --env-file=.env.local scripts/_makeedu/check-login.cjs
 * exit 0 = 들어가짐(세션 또는 로그인), exit 1 = 실패(사유를 한 줄로 출력 — 아이디는 출력하지 않는다).
 */
const G = require("./login-guard.cjs");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { page, via } = await G.openMakeeduContext(browser, { log: () => {} });
    console.log(`✅ makeedu 접속 확인 — ${via === "session" ? "저장 세션 유효(로그인 안 함)" : "ID/PW 로그인 성공(세션 저장)"} → ${page.url().slice(0, 45)}`);
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((e) => { console.error("✖ 접속 확인 오류:", e.message); process.exit(1); });
