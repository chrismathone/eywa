/**
 * scripts/_makeedu/human-login.cjs — makeedu **사람 로그인**(보이는 Chromium 창 · 5분).
 *
 * 2026-11-06부터 makeedu는 자동 로그인(navigator.webdriver)에 사람 확인(reCAPTCHA)을 요구한다. 원장 결정대로
 * **사람이 한 번 확인하고 그 로그인 상태(세션)를 자동 동기화가 재사용**한다. 이 스크립트는 그 '한 번'을 맡는다.
 *
 * - 보이는 창으로 login.do를 연다. 아이디(+ 연동 앱 설정이 열려 있으면 비밀번호)는 미리 채워 둘 수 있다 —
 *   단 비밀번호·계정 계열 멈춤이 있으면 저장 비밀번호는 채우지 않는다(틀린 값을 그대로 누르면 시도 횟수가 준다).
 * - 🔴 **로그인 버튼·사람 확인·'로그인상태유지' 체크는 사람이 누른다** — 자동 클릭·자동 제출·캡차 조작은 하지 않는다. 자동화 표시도 그대로 둔다.
 * - 5분 안에 로그인 계열 화면(login.do·loginReCert.do 등)을 벗어나고 **main.do 확인으로 로그인이 확인되면**
 *   세션(makeedu 사이트 쿠키·저장소만)을 원자적으로 저장하고 로그인 시각을 적는다.
 *   재인증 화면(loginReCert.do)이 나오면 사람이 거기까지 마쳐야 한다(그 화면에서는 저장하지 않는다).
 * - **headless 재사용 확인**(리뷰 13): 저장 직후 정기 실행과 똑같이(headless 브라우저 · 같은 세션 점검 함수 probeStoredSession ·
 *   main.do 한 번) 저장 세션을 점검한다. 통과 → 사람 확인 계열 멈춤(CAPTCHA_REQUIRED·NO_REJECT)을 지우고 성공 ·
 *   실패 → 멈춤은 그대로 두고 HEADLESS_REJECTED(makeedu가 브라우저를 바꾼 세션을 막는 것으로 보임 — makeedu 문의) ·
 *   판정 불가(네트워크) → 성공으로 두고 '확인 못 함'을 로그에. UA 위장·headless 끄기 같은 우회는 하지 않는다.
 *   비밀번호·계정 계열 멈춤(NO_LOGIN_CNT 등)은 어느 경우에도 남기고 결과에 `blockKept`로 알린다 — PC 설정에서 비밀번호를 저장해야 풀린다.
 * - **제출 진단**(리뷰 14 · 관찰만): 사람이 누른 제출(makeedu 출처의 loginPopProc POST만)마다 요청 본문에서 두 가지만 뽑아 로그에 남긴다 —
 *   g-recaptcha-response가 비어 있지 않은가(참/거짓) · loginBrowserRuntime 값. 🔴 본문·비밀번호·토큰 값 자체는 어디에도 남기지 않는다.
 *   캡차 토큰이 채워진 제출에도 CAPTCHA_REQUIRED가 다시 오면 '풀었는데 거절'(CAPTCHA_REJECTED)로 바로 끝낸다 — makeedu 문의가 필요하다.
 * - 시간이 넘거나 창을 닫으면 실패로 끝내고 멈춤 표시는 그대로 둔다.
 *
 * 실행: AYWA 연동 앱의 메이크에듀 칸 'makeedu 다시 로그인'(MAKEEDU_SESSION_FILE · PLAYWRIGHT_BROWSERS_PATH를 앱이 넣는다).
 *       연동 앱 없이(옛 연동 PC): node --env-file=.env.local scripts/_makeedu/human-login.cjs
 * 끝: 마지막 줄 `AYWA_HUMAN_LOGIN {"ok":…,"code":…}` · 0 = 성공 · 1 = 실패. 아이디·비밀번호·토큰은 출력하지 않는다.
 */
const G = require("./login-guard.cjs");

const RESULT_TAG = "AYWA_HUMAN_LOGIN";
const TIMEOUT_MS = 5 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 제출 진단(순수) — 요청 본문에서 **두 가지만**: g-recaptcha-response가 비어 있지 않은가(참/거짓) · loginBrowserRuntime 값(소문자 낱말만 ·
 * 그 밖은 'other' · 없으면 'none'). 본문·비밀번호·토큰 값은 돌려주지 않는다.
 */
function submissionDiag(postData) {
  let p;
  try {
    p = new URLSearchParams(String(postData ?? ""));
  } catch {
    p = new URLSearchParams();
  }
  const rt = p.get("loginBrowserRuntime");
  return { captchaToken: !!String(p.get("g-recaptcha-response") ?? "").trim(), runtime: rt == null || rt === "" ? "none" : /^[a-z]{1,20}$/.test(rt) ? rt : "other" };
}

/**
 * 이 응답이 사람이 누른 **makeedu 로그인 제출**인가(순수) — makeedu 출처(base와 같은 origin) · POST · 경로가 …/loginPopProc.do로 끝남(;jsessionid 허용).
 * 다른 출처(광고·구글 등)나 GET 응답이 마지막 응답(last)·'풀었는데 거절'을 세우지 않게(재리뷰 경미 5).
 */
function isLoginSubmit(url, method, base) {
  try {
    const u = new URL(String(url));
    return u.origin === new URL(base).origin && String(method).toUpperCase() === "POST" && /\/loginPopProc\.do(?:;|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** 도착 주소의 경로만(쿼리·조각·;jsessionid 같은 경로 매개변수 제외) — 로그에 세션 값이 새지 않게. */
function safePathname(url) {
  try {
    return new URL(String(url)).pathname.split(";")[0] || "/";
  } catch {
    return "(알 수 없음)";
  }
}

/**
 * headless 재사용 확인 — 정기 실행과 같은 방식(headless 브라우저 · probeStoredSession · main.do 한 번)으로 저장 세션을 점검한다.
 * 'alive' | 'dead' | 'unknown'(브라우저를 못 띄움·접속 실패 = 판정 불가).
 */
async function headlessReuseCheck({ launchHeadless, sessionFile, base }) {
  if (!launchHeadless) return "unknown";
  let hb;
  try {
    hb = await launchHeadless();
  } catch {
    return "unknown";
  }
  try {
    const probe = await G.probeStoredSession(hb, { sessionFile, env: {}, base, noteDead: false });
    if (probe.state === "alive") {
      await probe.ctx.close().catch(() => {});
      return "alive";
    }
    return probe.state === "dead" ? "dead" : "unknown";
  } catch {
    return "unknown";
  } finally {
    await hb.close().catch(() => {});
  }
}

/**
 * @param {object} o
 * @param {() => Promise<import('playwright').Browser>} o.launch  보이는 브라우저를 띄우는 함수(시험은 여기서 대역을 넣는다)
 * @param {() => Promise<import('playwright').Browser>} [o.launchHeadless]  정기 실행과 같은 headless 브라우저(재사용 확인용)
 * @param {(ctx:any, base:string) => Promise<boolean>} [o.confirm]  로그인 상태 확인(기본 = login-guard.confirmLoggedIn · main.do 확인)
 * @returns {Promise<{ok:boolean, code:string, headless?:string, blockKept?:string, last?:object|null}>}
 *
 * 성공 판정(리뷰 2026-11-06): 주소만 믿지 않는다. 창(컨텍스트 안 어느 탭이든)이 로그인 계열 화면을 **벗어나는 탐색**(루트 '/' 포함)이
 * 일어날 때마다, 같은 컨텍스트 쿠키로 세션 재사용 점검과 같은 기준(main.do 확인)으로 로그인됐는지 확인한다 — 확인됐을 때만 저장.
 * 같은 사이트의 오류 화면·잠깐 들렀다 로그인으로 되튕기는 화면은 확인에서 걸러진다. 확인 GET은 탐색 이벤트당 최대 1번 · 5분 창 동안만
 * (확인 중에 들어온 탐색은 하나로 묶는다).
 */
async function runHumanLogin({ launch, launchHeadless, base = G.BASE, sessionFile = G.defaultSessionFile(), id, pw, timeoutMs = TIMEOUT_MS, pollMs = 250, log = () => {}, confirm = G.confirmLoggedIn }) {
  let browser;
  try {
    browser = await launch();
  } catch {
    return { ok: false, code: "LAUNCH_FAILED" };
  }
  let closed = false;
  let last = null; // 사람이 누른 마지막 제출 — makeedu 응답 코드·남은 횟수 + 진단 두 가지(캡차 토큰 유무 · loginBrowserRuntime)
  let rejectedAfterCaptcha = false; // 캡차 토큰이 채워진 제출에도 CAPTCHA_REQUIRED
  let checkWanted = false; // 로그인 계열 화면을 벗어나는 탐색이 있었다 → 다음 차례에 한 번 확인
  let leftUrl = null; // 그 탐색의 도착 주소(성공 때 경로만 로그에)
  browser.on("disconnected", () => {
    closed = true;
  });
  // 비밀번호·계정 계열 멈춤(또는 읽지 못한 표시)이 있으면 저장 비밀번호를 미리 채우지 않는다 — 틀린 것으로 확인된 값을 그대로 누르면
  // 시도 횟수가 준다(리뷰 2026-11-06). 아이디는 그대로 채운다.
  const block = G.readBlock(sessionFile);
  const fillPw = !!pw && !(block && G.blockFamily(block.code) !== "human");
  if (pw && !fillPw) log("자동 로그인 멈춤(비밀번호·계정 확인) 중이라 저장된 비밀번호는 미리 채우지 않았습니다 — 창에서 직접 입력해 주세요.");
  try {
    const ctx = await browser.newContext();
    const watch = (pg) =>
      pg.on("framenavigated", (frame) => {
        if (frame === pg.mainFrame() && G.leftLoginPages(frame.url(), base)) {
          checkWanted = true;
          leftUrl = frame.url();
        }
      });
    ctx.on("page", watch);
    ctx.on("response", (r) => {
      if (!isLoginSubmit(r.url(), r.request().method(), base)) return;
      // 진단 두 가지만 — 본문(아이디·비밀번호·토큰)은 이 함수 밖으로 나가지 않는다.
      const diag = submissionDiag(r.request().postData());
      r.text()
        .then((t) => JSON.parse(t))
        .catch(() => null)
        .then((json) => {
          const c = json ? G.classifyLoginResult(json) : null;
          last = { code: c ? c.code : "UNREAD", remaining: c ? c.remaining : null, captchaToken: diag.captchaToken, runtime: diag.runtime };
          log(`제출 진단 — 캡차 토큰 ${diag.captchaToken ? "있음" : "없음"} · loginBrowserRuntime=${diag.runtime} · makeedu 응답 ${c ? c.code : "본문 못 읽음(화면 이동)"}`);
          if (c && c.code === "CAPTCHA_REQUIRED" && diag.captchaToken) rejectedAfterCaptcha = true;
        });
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/login.do`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    // 미리 채우기만 한다(제출·클릭 없음 · '로그인상태유지'도 건드리지 않는다). change를 알려 makeedu 화면이 칸 위 안내 글자를 치우게 한다.
    for (const [selector, value] of [["#membId", id], ["#password", fillPw ? pw : null]]) {
      if (!value) continue;
      const input = page.locator(selector);
      if (!(await input.count().catch(() => 0))) continue;
      await input.fill(value, { timeout: 5_000 }).catch(() => {});
      await input.dispatchEvent("change").catch(() => {});
    }
    await page.bringToFront().catch(() => {});
    log("makeedu 로그인 창을 열었습니다 — 창에서 로그인 버튼을 누르고 사람 확인을 마쳐 주세요(5분).");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (closed || !browser.isConnected()) return { ok: false, code: "CLOSED", last };
      if (!ctx.pages().length) return { ok: false, code: "CLOSED", last };
      if (rejectedAfterCaptcha) {
        log("🔴 사람 확인을 마친 제출도 makeedu가 다시 사람 확인을 요구했습니다(풀었는데 거절) — makeedu 문의가 필요합니다.");
        return { ok: false, code: "CAPTCHA_REJECTED", last };
      }
      if (checkWanted) {
        checkWanted = false;
        if (await confirm(ctx, base)) {
          if (closed) return { ok: false, code: "CLOSED", last };
          try {
            await G.saveSession(ctx, sessionFile, base); // makeedu 사이트 쿠키·저장소만
            G.writeMeta(sessionFile, "human");
          } catch {
            return { ok: false, code: "SAVE_FAILED", last };
          }
          log(`makeedu 로그인 확인 — 도착 화면 ${safePathname(leftUrl)} · 세션을 저장했습니다.`);
          await browser.close().catch(() => {}); // 사람 창은 여기서 닫는다(아래 확인은 몇 초)
          // 정기 실행과 똑같이 headless로 저장 세션을 한 번 점검(리뷰 13) — 통과해야 사람 확인 멈춤을 푼다.
          const headless = await headlessReuseCheck({ launchHeadless, sessionFile, base });
          if (headless === "dead") {
            log("🔴 headless 재사용 확인 실패 — 사람 로그인은 됐지만 자동 실행(headless)에서 그 세션을 쓸 수 없습니다(makeedu가 브라우저를 바꾼 세션을 막는 것으로 보임) · 자동 로그인 멈춤은 그대로 둡니다 — makeedu 문의가 필요합니다.");
            return { ok: false, code: "HEADLESS_REJECTED", headless, last };
          }
          log(headless === "alive" ? "headless 재사용 확인 통과 — 자동 실행이 이 세션을 씁니다." : "headless 재사용 확인 못 함(네트워크·브라우저 문제 — 판정 불가) — 성공으로 둡니다. 다음 정기 실행에서 확인됩니다.");
          let blockKept = null;
          try {
            // 사람 확인 계열(CAPTCHA_REQUIRED·NO_REJECT)만 지운다. 비밀번호·계정 계열은 PC 설정에서 비밀번호를 다시 저장해야 풀린다.
            blockKept = G.clearHumanBlock(sessionFile);
          } catch {
            return { ok: false, code: "SAVE_FAILED", headless, last };
          }
          log(blockKept ? `비밀번호·계정 확인 멈춤(${blockKept})은 남깁니다(연동 계정에 비밀번호를 다시 저장하면 풀림).` : "자동 로그인 멈춤 표시를 지웠습니다.");
          return blockKept ? { ok: true, code: "OK", headless, blockKept } : { ok: true, code: "OK", headless };
        }
      }
      await sleep(pollMs);
    }
    return { ok: false, code: "TIMEOUT", last };
  } catch {
    return { ok: false, code: closed ? "CLOSED" : "ERROR", last };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { runHumanLogin, submissionDiag, isLoginSubmit, safePathname, headlessReuseCheck, RESULT_TAG, TIMEOUT_MS };

if (require.main === module) {
  (async () => {
    let chromium;
    try {
      ({ chromium } = require("playwright"));
    } catch {
      ({ chromium } = require("@playwright/test"));
    }
    const result = await runHumanLogin({
      launch: () => chromium.launch({ headless: false }),
      // 재사용 확인 = 정기 실행(scrape·check-session 등)과 같은 headless 실행 — 인자·UA를 바꾸지 않는다.
      launchHeadless: () => chromium.launch({ headless: true }),
      sessionFile: G.defaultSessionFile(process.env),
      id: process.env.MAKEEDU_ID,
      pw: process.env.MAKEEDU_PW,
      log: (m) => console.log(m),
    });
    console.log(`${RESULT_TAG} ${JSON.stringify(result)}`);
    process.exit(result.ok ? 0 : 1);
  })().catch(() => {
    console.log(`${RESULT_TAG} ${JSON.stringify({ ok: false, code: "ERROR" })}`);
    process.exit(1);
  });
}
