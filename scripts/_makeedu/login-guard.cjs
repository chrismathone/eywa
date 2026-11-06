/**
 * scripts/_makeedu/login-guard.cjs — makeedu 로그인 **한 벌**(세션 재사용 → 자동 로그인 멈춤 표시 → ID/PW 1회).
 *
 * 🔴 배경(2026-11-06): makeedu가 2026-11-04에 로그인 화면에 `/js/login-bot-check.js`를 붙였다. 제출 때
 *   `loginBrowserRuntime = navigator.webdriver ? 'automation' : 'browser'`를 같이 보내고, 서버가
 *   `{result:'CAPTCHA_REQUIRED'}`를 돌려주면 **같은 화면에 구글 reCAPTCHA**를 띄운다. 그래서 Playwright 로그인은
 *   login.do에 머물렀고, 예전 코드는 이걸 "ID/PW 확인"으로 잘못 알렸다(11-06 06:00부터 동기화 전부 실패).
 *
 * 원장 결정(2026-11-06): **사람이 한 번 확인하고 로그인 상태를 재사용** + **정확한 진단과 재시도 멈춤**.
 *   - 자동화 표시를 숨기거나 감지를 피하는 일은 하지 않는다(navigator.webdriver·실행 인자·플러그인·캡차 풀이·
 *     loginBrowserRuntime 값 어느 것도 건드리지 않는다). 사람 확인이 필요하면 사람에게 넘긴다(human-login.cjs).
 *   - ID/PW 로그인은 **한 실행에 한 번**, 재시도 없음. OK가 아니면 '자동 로그인 멈춤' 표시를 남겨
 *     다음 실행부터 같은 자격으로는 다시 시도하지 않는다(시도마다 계정 잠김 위험 — NO_LOGIN_CNT).
 *
 * 파일(세션 파일과 같은 폴더):
 *   session.json        Playwright storageState(쿠키) — 원자적으로 쓴다(임시 파일 → rename).
 *   login-blocked.json  자동 로그인 멈춤 표시 {code, message, at, credSalt, credHash[, remaining]} — 지문은 솔트 붙인 scrypt · 비밀번호 원문은 없다.
 *                       본 파일을 두 번 다 못 쓰면 login-blocked.alt.json(예비)에 남기고, 그것도 못 쓰면 크게 알린다(다음 실행이 다시 시도할 수 있음).
 *   ⚠️ 판정 불가(응답 없음·접속 실패)에는 멈춤을 남기지 않는다 — 그런 실행이 이어지면 실행마다 ID/PW를 한 번씩 시도할 수 있다
 *      (비밀번호 틀림은 makeedu가 JSON으로 답하므로 판정 불가로 빠질 일은 드물어 잠김 위험은 낮다 · 리뷰 2026-11-06 그대로 두기로).
 *   session-meta.json   새 로그인 시각 {loggedInAt, method} — 세션 수명 기록의 '로그인 후' 기준.
 *   session-dead.json   세션 끊김을 이미 적은 세션 파일 판 {version, at} — 수명 한 줄을 처음 한 번만 남기려고.
 *
 * 세션 유지(원장 2026-11-06 "10분마다 하지말고 하루마다로 그냥 해"): 따로 깨우는 타이머는 없다. 하루 1번 접속 점검(check-session)과
 * 하루 2번 정기 동기화가 저장 세션을 먼저 쓰며 확인·갱신한다. 끊긴 걸 처음 알면 '세션 저장 후 몇 시간'을 로컬 로그에 한 줄 남긴다.
 *
 * 쓰는 곳: scrape · check-session · check-login · sync-consultations(-incremental) · sync-prospects ·
 *          push-consultations · import-monthly-enrolled · human-login.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://school.makeedu.co.kr";
const REPO = path.resolve(__dirname, "..", "..");
const RESPONSE_TIMEOUT_MS = 20_000;
const HUMAN_ACTION = "동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'이 필요합니다";
/**
 * 멈춤 갈래(원장·팀장 결정 2026-11-06 · 적대 리뷰 반영).
 *   human    사람 확인 계열(CAPTCHA_REQUIRED · NO_REJECT 재인증) — 사람이 'makeedu 다시 로그인'에 성공하면 풀린다.
 *   password 비밀번호 계열(NO_LOGIN_CNT · NO_CHK) — 저장된 비밀번호가 틀렸다. 사람 로그인으로는 풀지 않고, 사람 창에 저장 비밀번호를
 *            미리 채우지도 않는다(틀린 값을 그대로 누르면 시도 횟수가 준다). PC 설정에서 비밀번호를 다시 저장할 때만 풀린다.
 *   account  계정 계열(NOK · NO_PASS · NO_PTYPE · NOK_LIMIT · 모르는 코드) — makeedu 쪽에서 해결할 일. 풀리는 조건은 비밀번호 계열과 같다
 *            (PC 설정에서 비밀번호를 한 번 더 저장 — 같은 값이어도). 미리 채우기도 같은 이유로 하지 않는다.
 *   그동안 살아 있는 저장 세션은 계속 쓴다.
 * ⚠️ 연동 앱 apps/sync-agent/lib/makeedu-login.cjs · 웹 src/features/integrations/sync-error.ts에 같은 표가 있다(시험이 맞춘다).
 */
const HUMAN_BLOCK_CODES = ["CAPTCHA_REQUIRED", "NO_REJECT"];
const PASSWORD_BLOCK_CODES = ["NO_LOGIN_CNT", "NO_CHK"];
const isHumanBlock = (code) => HUMAN_BLOCK_CODES.includes(code);
/** 멈춤 갈래 — 'human' | 'password' | 'account'(모르는 코드·깨진 표시 포함). */
const blockFamily = (code) => (isHumanBlock(code) ? "human" : PASSWORD_BLOCK_CODES.includes(code) ? "password" : "account");
const PASSWORD_ACTION = "AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 확인해 다시 저장해야 자동 로그인이 풀립니다";
const ACCOUNT_ACTION = "makeedu에서 해결한 뒤 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다";
// makeedu 화면 원문 기준(login.html submitHandler) — 원인 한 마디.
const ACCOUNT_WHAT = {
  NOK: "makeedu 계정이 미인증 상태입니다",
  NO_PASS: "makeedu 호출정보가 올바르지 않습니다",
  NO_PTYPE: "makeedu가 이 계정을 무료형·실속형(라이트) 사용자로 안내합니다",
  NOK_LIMIT: "makeedu가 사용 기한·결제 화면으로 안내합니다",
};
const safeCode = (code) => (/^[A-Za-z_]{1,40}$/.test(String(code)) ? String(code) : "UNKNOWN");
/**
 * 동기화 PC의 멈춤 표시 파일을 **읽지 못했을 때**(내용 깨짐·읽기 오류)의 내부 코드 — makeedu가 보낸 모르는 응답(UNKNOWN·새 코드)과 구분한다
 * (재리뷰 경미 4). 안전하게 멈춘 쪽(계정 계열 · 지문 없음 → 같은 자격으로 보고 막음) · 연동 계정에서 비밀번호를 한 번 더 저장하면 다시 시도.
 */
const BLOCK_UNREADABLE = "BLOCK_UNREADABLE";
const UNREADABLE_WHAT = "동기화 PC의 makeedu 자동 로그인 멈춤 기록을 읽지 못했습니다";
// 같은 코드 중 **읽기 자체가 실패**(잠김·권한·백신 등 · ENOENT 제외 — readError)한 경우의 문구(fix4). 사람 로그인으로도 비밀번호 저장으로도
// 풀리지 않으므로(무엇인지 모르는 표시는 지우지 않는다) 비밀번호 저장 안내를 넣지 않는다. 파일을 다시 읽을 수 있으면 원래 표시대로 돌아간다.
const UNREADABLE_READ_WHAT = "동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등)";
const UNREADABLE_READ_TODO = "안전을 위해 자동 로그인을 멈춰 두었습니다 · 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다)";
/** 코드별 원인 한 마디(사람 확인 계열 제외). */
function codeHeadline(code, remaining = null) {
  if (code === "NO_LOGIN_CNT") return `makeedu 로그인 정보가 올바르지 않습니다 · ${Number.isInteger(remaining) ? `남은 시도 ${remaining}회` : "남은 시도 횟수 모름"}`;
  if (code === "NO_CHK") return "makeedu 인증정보가 올바르지 않습니다";
  if (code === BLOCK_UNREADABLE) return UNREADABLE_WHAT;
  return ACCOUNT_WHAT[code] ?? `makeedu가 알 수 없는 응답(${safeCode(code)})으로 로그인을 거절했습니다`;
}

// ─── 판정(순수) ───────────────────────────────────────────────────────────────

/**
 * `/loginPopProc.do` 응답 JSON → `{ok, code, message, blockAuto, remaining}`.
 *   ok: true = 로그인됨 · false = makeedu가 거절함 · null = **판정 불가**(응답 없음·해석 불가 — 멈추지 않는다).
 *   ⚠️ 판정 불가가 이어지면 실행마다(하루 최대 몇 번) ID/PW를 다시 시도할 수 있다 — 비밀번호 틀림은 makeedu가 JSON(NO_LOGIN_CNT)으로
 *      답하므로 판정 불가로 빠질 일은 드물어 잠김 위험은 낮다(리뷰 2026-11-06 — 그대로 두기로).
 *   message: 한글 · 개인정보 없음(아이디를 넣지 않는다) · 원인 + 할 일.
 *   blockAuto: OK가 아닌 makeedu 응답은 전부 true — 같은 자격으로 다시 시도하지 않는다.
 * 처리 목록은 makeedu login.html의 submitHandler와 같다(OK · NO_LOGIN_CNT · NOK · NO_CHK · NO_REJECT · NO_PTYPE ·
 * NO_PASS · NOK_LIMIT · 그 밖) + login-bot-check.js의 CAPTCHA_REQUIRED.
 */
function classifyLoginResult(json) {
  if (json == null || typeof json !== "object")
    return { ok: null, code: "NO_RESPONSE", message: "makeedu 로그인 응답을 받지 못했습니다(네트워크·사이트 문제일 수 있음 — 판정 불가)", blockAuto: false, remaining: null };
  const raw = typeof json.result === "string" ? json.result.trim() : "";
  if (!raw)
    return { ok: null, code: "BAD_RESPONSE", message: "makeedu 로그인 응답을 해석하지 못했습니다(판정 불가)", blockAuto: false, remaining: null };
  const fail = (code, message, remaining = null) => ({ ok: false, code, message, blockAuto: true, remaining });
  if (raw === "OK") return { ok: true, code: "OK", message: "makeedu 로그인 성공", blockAuto: false, remaining: null };
  if (raw === "CAPTCHA_REQUIRED") return fail(raw, `makeedu가 자동 로그인에 사람 확인을 요구합니다 — ${HUMAN_ACTION}`);
  // 재인증(loginReCert.do)도 사람 확인과 같은 갈래 — 사람이 'makeedu 다시 로그인' 창에서 재인증까지 마치면 풀린다.
  if (raw === "NO_REJECT") return fail(raw, `makeedu가 자동 로그인에 사람 확인(재인증)을 요구합니다 — ${HUMAN_ACTION}`);
  if (raw === "NO_LOGIN_CNT") {
    const n = Number(json.result_cnt);
    const remaining = Number.isInteger(n) && n >= 0 ? n : null;
    return fail(raw, `${codeHeadline(raw, remaining)} — ${PASSWORD_ACTION}(더 틀리면 계정이 잠길 수 있습니다)`, remaining);
  }
  const code = safeCode(raw);
  return fail(code, `${codeHeadline(code)} — ${blockFamily(code) === "password" ? PASSWORD_ACTION : ACCOUNT_ACTION}`);
}

/**
 * 자격 지문 — scrypt(id + "\0" + pw, 솔트) 16바이트(hex 32자). 솔트는 멈춤 표시마다 새로 뽑는 무작위 16바이트다.
 * 비밀번호 원문·되돌릴 수 있는 형태는 어디에도 남기지 않는다 — 솔트 + 느린 해시라 표시 파일이 새도 사전 대입이 비싸다(팀장 2026-11-06).
 * 쓰임은 '같은 자격으로 다시 시도하지 않기' 하나뿐(자격이 바뀌면 한 번 다시).
 */
function credHash(id, pw, salt) {
  if (typeof salt !== "string" || !/^[0-9a-f]{32}$/.test(salt)) throw new Error("credHash: 솔트(hex 32자)가 필요합니다");
  return crypto.scryptSync(`${id ?? ""}\0${pw ?? ""}`, Buffer.from(salt, "hex"), 16).toString("hex");
}
const newCredSalt = () => crypto.randomBytes(16).toString("hex");

/** 멈춤 표시가 지금 자격에 걸리는가 — 같은 자격이면 true. 표시를 못 읽었으면(지문·솔트 없음) 안전하게 true. */
function blockApplies(block, id, pw) {
  if (!block) return false;
  if (!block.credHash || !block.credSalt) return true;
  try {
    return crypto.timingSafeEqual(Buffer.from(block.credHash, "hex"), Buffer.from(credHash(id, pw, block.credSalt), "hex"));
  } catch {
    return true; // 모양이 이상한 지문 — 멈춘 쪽으로
  }
}

// makeedu의 로그인 계열 화면 — 경로에 login·logout이 있으면(대소문자 무시 · 예전 판정 범위 유지) 또는 아이디·비밀번호 찾기면 로그인된 것이 아니다.
const LOGINISH_PATH = /log(?:in|out)|\/(?:findId|findPassword)\.do(?:[;?#]|$)/i;
const sameSite = (url, base) => {
  try {
    const u = new URL(String(url));
    return /^https?:$/.test(u.protocol) && u.origin === new URL(base).origin ? u : null;
  } catch {
    return null;
  }
};

/** 이 주소가 makeedu에 **로그인된 화면**인가(같은 사이트 · 로그인 계열 화면 아님 · 루트 아님). */
function isLoggedInUrl(url, base = BASE) {
  const u = sameSite(url, base);
  if (!u) return false;
  if (u.pathname === "/" || u.pathname === "") return false;
  return !LOGINISH_PATH.test(u.pathname);
}

/** 사람 창이 로그인 계열 화면을 **벗어났나**(같은 사이트 · 루트 '/' 포함) — 벗어날 때마다 로그인 상태를 확인한다(주소만 믿지 않는다). */
function leftLoginPages(url, base = BASE) {
  const u = sameSite(url, base);
  return !!u && !LOGINISH_PATH.test(u.pathname);
}

/**
 * 제출 뒤 화면이 옮겨 간 곳 → makeedu 결과 코드(login.html submitHandler의 이동 대응표) · 모르면 null.
 * OK → locationUrl(메인 등) · NO_REJECT → /loginReCert.do · NOK_LIMIT → /loginUsePay.do · NO_PTYPE → free/lite 사이트.
 */
function resultFromUrl(url, base = BASE) {
  let u, b;
  try {
    u = new URL(String(url));
    b = new URL(base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.origin !== b.origin) return /(?:^|\.)makeedu\.co\.kr$/i.test(u.hostname) ? "NO_PTYPE" : null;
  if (/\/loginReCert\.do(?:[;?#]|$)/i.test(u.pathname)) return "NO_REJECT";
  if (/\/loginUsePay\.do(?:[;?#]|$)/i.test(u.pathname)) return "NOK_LIMIT";
  return isLoggedInUrl(u.toString(), base) ? "OK" : null;
}

const kstMinute = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
};

/** 던지는 오류의 한 줄 문구 — sync-all이 `ERR <문구>`를 makeedu_sync_runs.error로 옮기고, 웹(sync-error.ts)이 한글로 바꾼다. */
/**
 * blockNote: 'write_failed' = 멈춤 표시를 어디에도 못 남겼다(다음 실행이 같은 자격으로 다시 시도할 수 있음 — 크게 알린다) ·
 *            'fallback' = 예비 표시에 남겼다 · 'human_saved' = 이 시도 중에 사람 로그인이 세션을 저장해 멈춤을 남기지 않았다.
 */
function loginErrorMessage(result, { blocked = false, at = null, blockNote = null } = {}) {
  const code = result.code || "UNKNOWN";
  const text = String(result.message || "").replace(/\s+/g, " ").trim();
  if (blocked) {
    const since = at ? kstMinute(at) : "";
    return `makeedu 자동 로그인 멈춤 [${code}] — ${text}${since ? ` (${since}부터 · ID/PW 재시도 안 함)` : " (ID/PW 재시도 안 함)"}`;
  }
  const tail =
    blockNote === "write_failed"
      ? " · ⚠️ 멈춤 표시 저장 실패 — 다음 실행이 같은 자격으로 다시 시도할 수 있음"
      : blockNote === "human_saved"
        ? " · 그 사이 사람 로그인 세션이 저장돼 멈춤 표시는 남기지 않음"
        : result.blockAuto
          ? " · 자동 로그인 멈춤(ID/PW 재시도 안 함)"
          : "";
  return `${text} [${code}]${tail}`;
}

class MakeeduLoginError extends Error {
  constructor(result, { blocked = false, at = null, blockNote = null } = {}) {
    super(loginErrorMessage(result, { blocked, at, blockNote }));
    this.name = "MakeeduLoginError";
    this.ok = result.ok === null ? null : false;
    this.code = result.code || "UNKNOWN";
    this.remaining = result.remaining ?? null;
    this.blocked = blocked;
    this.blockAuto = !!result.blockAuto;
    this.blockNote = blockNote;
    this.readError = result.readError === true; // 멈춤 기록 파일 읽기 자체 실패(BLOCK_UNREADABLE 중) — 벨 문구 고르기용(fix4)
    this.reason = result.message || "";
  }
}

/**
 * check-session.mjs의 벨 문구(제목·본문) — 사유별. 감지일(today, YYYY-MM-DD)만 받는다(개인정보 없음).
 * INSERT 문장은 그대로 두고 **값만** 바꾼다(질의 목록 고정).
 */
function notificationTextFor({ code, remaining, readError = false } = {}, today) {
  if (isHumanBlock(code))
    return {
      title: "makeedu가 사람 확인을 요구합니다",
      body: `makeedu 자동 동기화가 멈췄습니다 — 동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'을 눌러 확인 한 번 해 주세요. (감지 ${today})`,
    };
  if (code === "NO_LOGIN_CNT")
    return {
      title: `makeedu 로그인 정보가 올바르지 않습니다${Number.isInteger(remaining) ? `(남은 시도 ${remaining}회)` : ""}`,
      body: `makeedu 자동 동기화가 멈췄습니다 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 확인해 다시 저장해 주세요 — 저장하면 자동 로그인이 풀립니다(더 틀리면 계정이 잠길 수 있습니다). (감지 ${today})`,
    };
  if (code === "NO_CHK")
    return {
      title: "makeedu 인증정보가 올바르지 않습니다",
      body: `makeedu 자동 동기화가 멈췄습니다 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 확인해 다시 저장해 주세요 — 저장하면 자동 로그인이 풀립니다. (감지 ${today})`,
    };
  // 멈춤 기록 파일을 열 수 없음(읽기 자체 실패 · fix4) — 비밀번호 저장으로 풀리지 않는다. PC 재시작·백신 예외·폴더 권한.
  if (code === BLOCK_UNREADABLE && readError === true)
    return {
      title: "동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다",
      body: `안전을 위해 makeedu 자동 로그인을 멈춰 두었습니다 — 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다). (감지 ${today})`,
    };
  // 동기화 PC의 멈춤 기록을 읽지 못함(내용 깨짐) — makeedu가 거절한 것이 아니다(재리뷰 경미 4). makeedu에서 해결할 일은 없고 비밀번호 한 번 더 저장.
  if (code === BLOCK_UNREADABLE)
    return {
      title: "동기화 PC의 makeedu 멈춤 기록을 읽지 못했습니다",
      body: `안전을 위해 makeedu 자동 로그인을 멈췄습니다 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다. (감지 ${today})`,
    };
  // 계정 계열·모르는 makeedu 응답(멈춤으로 이어진 코드) — 원인 + makeedu에서 해결 → 비밀번호 한 번 더 저장. 내부 코드(NO_CREDENTIALS 등)는 아래 기존 문구.
  if (code && code !== "NO_CREDENTIALS" && blockFamily(code) === "account")
    return {
      title: codeHeadline(code),
      body: `makeedu 자동 동기화가 멈췄습니다 — makeedu에서 해결한 뒤 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다. (감지 ${today})`,
    };
  return {
    title: "makeedu 접속이 실패했습니다",
    body: `makeedu 동기화가 멈춥니다 — 비밀번호 변경·CAPTCHA·계정 잠금을 확인해 주세요. (감지 ${today})`,
  };
}

// ─── 파일 ─────────────────────────────────────────────────────────────────────

/** 세션 파일 — MAKEEDU_SESSION_FILE(연동 앱: <지점>/state/makeedu/session.json), 없으면 <repo>/.makeedu-tmp/session.json. */
function defaultSessionFile(env = process.env) {
  return env.MAKEEDU_SESSION_FILE || path.join(REPO, ".makeedu-tmp", "session.json");
}
const blockFileOf = (sessionFile) => path.join(path.dirname(sessionFile), "login-blocked.json");
const metaFileOf = (sessionFile) => path.join(path.dirname(sessionFile), "session-meta.json");
const deadMarkFileOf = (sessionFile) => path.join(path.dirname(sessionFile), "session-dead.json");

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 임시 파일에 쓰고 rename — 읽는 쪽(다른 단계·사람 로그인)이 반쯤 쓴 파일을 보지 않는다. Windows의 잠깐 잠금은 몇 번 다시. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt < 5 && ["EPERM", "EBUSY", "EACCES"].includes(e.code)) {
        sleepSync(100 * (attempt + 1));
        continue;
      }
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* 임시 파일 정리 실패는 무시 */
      }
      throw e;
    }
  }
}

// 본 표시 파일을 못 쓸 때(백신·잠금 등) 남기는 예비 표시 — 읽기·지우기는 둘 다 본다. 연동 앱은 예비 표시면 경고를 띄운다.
const blockFallbackOf = (sessionFile) => path.join(path.dirname(sessionFile), "login-blocked.alt.json");
const UNREADABLE_BLOCK = {
  code: BLOCK_UNREADABLE,
  message: `${UNREADABLE_WHAT} — 안전을 위해 자동 로그인을 멈춥니다 · AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다`,
  at: null,
  credHash: null,
  credSalt: null,
  remaining: null,
  unreadable: true,
  readError: false, // 내용 깨짐 — 연동 앱의 비밀번호 저장이 지우므로 그 안내를 한다
};
// 읽기 자체 실패(잠김·권한 등) — 같은 코드·갈래(계정 계열 · 지문 없음 → 막음)이고 문구만 다르다(fix4).
const UNREADABLE_READ_BLOCK = { ...UNREADABLE_BLOCK, message: `${UNREADABLE_READ_WHAT} — ${UNREADABLE_READ_TODO}`, readError: true };

function parseBlockFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    return { ...UNREADABLE_READ_BLOCK };
  }
  try {
    const b = JSON.parse(text);
    if (!b || typeof b !== "object" || typeof b.code !== "string") throw new Error("shape");
    return {
      code: b.code,
      message: typeof b.message === "string" ? b.message : "",
      at: typeof b.at === "string" ? b.at : null,
      credHash: typeof b.credHash === "string" ? b.credHash : null,
      credSalt: typeof b.credSalt === "string" ? b.credSalt : null,
      remaining: Number.isInteger(b.remaining) ? b.remaining : null,
    };
  } catch {
    return { ...UNREADABLE_BLOCK };
  }
}

/**
 * 멈춤 표시 읽기 — 없으면 null · 깨졌으면 '알 수 없는 멈춤'(안전하게 멈춘 쪽으로) · 예비 표시면 fallback:true.
 * 본·예비가 둘 다 있으면 **더 최근 것**(본 파일이 낡은 채 덮이지 않고 예비에 새 표시가 쓰인 경우) · 본 파일을 못 읽으면 예비를 본다.
 */
function readBlock(sessionFile) {
  const main = parseBlockFile(blockFileOf(sessionFile));
  const altRaw = parseBlockFile(blockFallbackOf(sessionFile));
  const alt = altRaw && !altRaw.unreadable ? { ...altRaw, fallback: true } : null;
  if (!main) return alt ?? altRaw;
  if (main.unreadable) return alt ?? main;
  if (alt && Date.parse(alt.at ?? "") > Date.parse(main.at ?? "")) return alt;
  return main;
}

/**
 * 멈춤 표시 쓰기 — 본 파일을 **한 번 더** 시도하고, 그래도 안 되면 예비 파일에 남긴다(표시가 살아 있어야 같은 자격 재시도를 막는다).
 * 돌려주는 값: { ...표시, stored: 'main' | 'fallback' | null } — null이면 어디에도 못 남겼다(호출한 쪽이 크게 알린다).
 */
function writeBlock(sessionFile, result, id, pw, now = new Date()) {
  const credSalt = newCredSalt();
  const body = { code: result.code, message: result.message, at: now.toISOString(), credSalt, credHash: credHash(id, pw, credSalt) };
  if (Number.isInteger(result.remaining)) body.remaining = result.remaining;
  const text = JSON.stringify(body, null, 2);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeAtomic(blockFileOf(sessionFile), text);
      try {
        fs.rmSync(blockFallbackOf(sessionFile), { force: true });
      } catch {
        /* 낡은 예비 표시 — 다음 지우기에서 */
      }
      return { ...body, stored: "main" };
    } catch {
      /* 한 번 더 */
    }
  }
  try {
    writeAtomic(blockFallbackOf(sessionFile), text);
    return { ...body, stored: "fallback" };
  } catch {
    return { ...body, stored: null };
  }
}

/** 멈춤 표시 지우기(본·예비 둘 다). 못 지우면 던진다 — 지운 줄 알고 넘어가면 안 된다. */
function clearBlock(sessionFile) {
  for (const file of [blockFileOf(sessionFile), blockFallbackOf(sessionFile)]) fs.rmSync(file, { force: true });
}

/**
 * 사람 로그인이 성공했을 때 — **사람 확인 계열 멈춤만** 지운다. 본·예비 표시를 **파일마다** 갈래를 보고 사람 확인 계열 파일만 지운다
 * (재리뷰 경미 2 — 한쪽이 사람 확인이라고 다른 쪽의 비밀번호·계정 표시까지 지우지 않는다 · 읽지 못한 파일도 남긴다).
 * 남은 표시가 있으면 readBlock과 같은 규칙으로 고른 그 코드를 돌려준다(PC 설정에서 계정을 다시 저장해야 풀린다 · 그동안 저장 세션은 계속 쓴다).
 * 표시가 없거나 다 지웠으면 null. 못 지우면 던진다.
 */
function clearHumanBlock(sessionFile) {
  for (const file of [blockFileOf(sessionFile), blockFallbackOf(sessionFile)]) {
    const b = parseBlockFile(file);
    if (b && !b.unreadable && isHumanBlock(b.code)) fs.rmSync(file, { force: true });
  }
  return readBlock(sessionFile)?.code ?? null;
}

function writeMeta(sessionFile, method, now = new Date()) {
  writeAtomic(metaFileOf(sessionFile), JSON.stringify({ loggedInAt: now.toISOString(), method }));
}

function readMeta(sessionFile) {
  try {
    const m = JSON.parse(fs.readFileSync(metaFileOf(sessionFile), "utf8"));
    return m && typeof m.loggedInAt === "string" ? m : null;
  } catch {
    return null;
  }
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "알 수 없음";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h ? `${h}시간 ${m % 60}분` : `${m}분`;
}

/**
 * 세션 수명 한 줄(순수) — 끊긴 걸 처음 알았을 때 로컬 로그에 남긴다. 개인정보·쿠키 값 없음.
 * 세션 파일은 쓸 때마다(살아 있음을 확인할 때마다) 다시 저장되므로 '세션 저장 후'는 마지막 정상 확인 뒤 흐른 시간이다.
 * 로그인 시각(session-meta.json)이 있으면 '로그인 후'도 함께 적는다 — 세션이 실제로 몇 시간 사는지의 실측 자료.
 */
function sessionLifetimeLine({ savedAtMs, meta = null, now = Date.now() }) {
  const parts = [`세션 저장 후 ${formatAge(now - savedAtMs)}(마지막 정상 확인 때 저장)`];
  if (meta && typeof meta.loggedInAt === "string") {
    const how = meta.method === "human" ? "사람 로그인" : meta.method === "idpw" ? "ID/PW 로그인" : meta.method === "capture" ? "세션 캡처" : "로그인";
    parts.push(`로그인 후 ${formatAge(now - Date.parse(meta.loggedInAt))}(${how})`);
  }
  return `makeedu 세션 수명 — 저장 세션이 끊긴 것을 처음 확인: ${parts.join(" · ")}`;
}

/**
 * 하루 1번 접속 점검(check-session)의 세션 상태 한 줄(순수) — 로그인 시각(session-meta.json) 기준 '로그인 후 N시간'.
 * state: 'alive'(저장 세션으로 들어감) · 'dead'(저장 세션이 끊김) · 'none'(저장 세션 없음) · 'unknown'(접속 확인 못 함).
 * 매일 남기므로 살아 있던 마지막 날과 끊긴 첫날 사이가 세션 수명의 실측 범위가 된다. 개인정보·쿠키 값 없음.
 */
function sessionStatusLine({ state, meta = null, now = Date.now() }) {
  const head = { alive: "makeedu 세션 살아 있음", dead: "makeedu 세션 끊김", none: "makeedu 저장 세션 없음", unknown: "makeedu 세션 확인 못 함(판정 불가)" }[state] || "makeedu 세션 상태 모름";
  if (state === "none" || state === "unknown") return head;
  if (!meta || typeof meta.loggedInAt !== "string") return `${head} — 로그인 시각 기록 없음`;
  const how = meta.method === "human" ? "사람 로그인" : meta.method === "idpw" ? "ID/PW 로그인" : meta.method === "capture" ? "세션 캡처" : "로그인";
  return `${head} — 로그인 후 ${formatAge(now - Date.parse(meta.loggedInAt))}(${how})`;
}

/**
 * 점검 결과 → 세션 상태(순수). hadSession = 점검 전에 세션 파일이 있었나 · via = openMakeeduContext 성공 경로 ·
 * errorCode = 실패한 MakeeduLoginError 코드(그 밖의 오류는 null).
 *   via 'session' → alive · 세션 파일 없었음 → none · 세션 확인 자체를 못 함(SESSION_CHECK_FAILED·알 수 없는 오류) → unknown ·
 *   그 밖(세션을 지나 ID/PW 단계까지 갔다 = 저장 세션이 끊겼다) → dead.
 */
function sessionStateAfterProbe({ hadSession, via = null, ok = null, errorCode = null }) {
  if (via === "session") return "alive";
  if (!hadSession) return "none";
  if (ok === true) return "dead"; // 저장 세션은 끊겼고 ID/PW로 새로 들어갔다
  if (!errorCode || errorCode === "SESSION_CHECK_FAILED" || errorCode === "SESSION_READ_FAILED") return "unknown";
  return "dead";
}

/**
 * 저장 세션이 끊긴 걸 확인했을 때 — 이 세션 파일(판 = 수정 시각·크기)에 대해 **처음 한 번만** 수명 한 줄을 남긴다.
 * 다음 실행이 같은 죽은 파일을 다시 봐도 적지 않는다(사람 로그인·ID/PW 성공으로 파일이 바뀌면 다음 끊김을 다시 적는다).
 * 돌려주는 값: 남긴 줄 · 이미 적었으면 null.
 */
function noteSessionDead(sessionFile, { log = () => {}, now = Date.now() } = {}) {
  let st;
  try {
    st = fs.statSync(sessionFile);
  } catch {
    return null;
  }
  const version = `${Math.round(st.mtimeMs)}:${st.size}`;
  const markFile = deadMarkFileOf(sessionFile);
  try {
    if (JSON.parse(fs.readFileSync(markFile, "utf8"))?.version === version) return null;
  } catch {
    /* 표식 없음·깨짐 → 처음 */
  }
  const line = sessionLifetimeLine({ savedAtMs: st.mtimeMs, meta: readMeta(sessionFile), now });
  log(line);
  try {
    writeAtomic(markFile, JSON.stringify({ version, at: new Date(now).toISOString() }));
  } catch {
    /* 표식을 못 남기면 다음 실행이 한 번 더 적을 뿐이다 */
  }
  return line;
}

/**
 * 저장할 로그인 상태에서 **makeedu 사이트 것만** 남긴다(순수) — 이 사이트로 보내질 쿠키(같은 호스트·상위 도메인)와 같은 출처 저장소.
 * 사람 창에서 붙은 구글 reCAPTCHA 등 바깥 쿠키·저장소는 버린다(리뷰 2026-11-06).
 */
function filterStorageForSite(state, base = BASE) {
  const b = new URL(base);
  const host = b.hostname.toLowerCase();
  const cookies = (Array.isArray(state?.cookies) ? state.cookies : []).filter((c) => {
    const d = String(c?.domain || "").toLowerCase().replace(/^\./, "");
    return !!d && (host === d || host.endsWith(`.${d}`));
  });
  const origins = (Array.isArray(state?.origins) ? state.origins : []).filter((o) => o && o.origin === b.origin);
  return { ...state, cookies, origins };
}

async function saveSession(ctx, sessionFile, base = BASE) {
  writeAtomic(sessionFile, JSON.stringify(filterStorageForSite(await ctx.storageState(), base)));
}

// makeedu 로그인 화면 고유 표식 — 200으로 와도 이게 보이면 로그인된 화면이 아니다.
const LOGIN_FORM_MARK = /loginPopProc\.do|login-bot-check\.js/i;

/**
 * 이 브라우저 컨텍스트(쿠키)가 makeedu에 **로그인돼 있나** — 세션 재사용 점검과 같은 기준: main.do를 열어(리다이렉트 따라감)
 * 닿은 곳이 로그인된 화면이고(200 · 로그인 계열 주소 아님) 로그인 폼이 아니면 true. GET 한 번 · 15초 · 화면(탭)은 건드리지 않는다.
 * 사람 창의 성공 판정에 쓴다 — 주소 가정(같은 사이트의 오류 화면 등)으로 잘못 성공하지 않게.
 */
async function confirmLoggedIn(ctx, base = BASE, { timeoutMs = 15_000 } = {}) {
  let res;
  try {
    res = await ctx.request.get(`${base}/main.do`, { timeout: timeoutMs, failOnStatusCode: false });
  } catch {
    return false;
  }
  try {
    if (res.status() !== 200 || !isLoggedInUrl(res.url(), base)) return false;
    const body = await res.text().catch(() => "");
    return !LOGIN_FORM_MARK.test(body);
  } finally {
    await res.dispose().catch(() => {});
  }
}

/** 저장 세션 — 세션 파일 우선, 없으면 예전 MAKEEDU_STORAGE_STATE(JSON 문자열, GitHub Actions 시크릿) 호환. */
function loadStorage(sessionFile, env = process.env, log = () => {}) {
  if (sessionFile) {
    let text = null;
    try {
      text = fs.readFileSync(sessionFile, "utf8");
    } catch (e) {
      // 파일이 없을 때만 '세션 없음'. 잠김(EBUSY 등)·권한 같은 읽기 실패는 판정 불가 — ID/PW로 넘어가지 않는다(리뷰 2026-11-06).
      if (e.code !== "ENOENT")
        throw new MakeeduLoginError({ ok: null, code: "SESSION_READ_FAILED", message: `저장 세션 파일을 읽지 못했습니다(${e.code || "오류"} — 판정 불가 · ID/PW로 넘어가지 않음)` });
    }
    if (text != null) {
      try {
        return { storage: JSON.parse(text), source: "file" };
      } catch {
        log("⚠️ 저장 세션 파일이 깨져 있습니다 — 세션 없이 진행합니다");
      }
    }
  }
  if (env.MAKEEDU_STORAGE_STATE) {
    try {
      return { storage: JSON.parse(env.MAKEEDU_STORAGE_STATE), source: "env" };
    } catch {
      throw new Error("MAKEEDU_STORAGE_STATE 파싱 실패 — capture-session.cjs로 다시 캡처하세요.");
    }
  }
  return { storage: null, source: null };
}

// ─── 브라우저 ─────────────────────────────────────────────────────────────────

/**
 * login.do에서 ID/PW를 **한 번** 제출하고 `/loginPopProc.do` 응답 JSON으로 판정한다(재시도 없음).
 * `#membId`·`#password`가 없을 때만 예전 범용 셀렉터(첫 password 칸 · 그 앞 text 칸)로 떨어진다.
 * 제출은 makeedu 화면이 하는 그대로(로그인 버튼 클릭 → 화면 스크립트가 loginBrowserRuntime을 채워 POST) — 값은 건드리지 않는다.
 */
async function submitLogin(page, { id, pw, base = BASE, responseTimeoutMs = RESPONSE_TIMEOUT_MS } = {}) {
  await page.goto(`${base}/login.do`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator('#membId, input[type="password"]').first().waitFor({ timeout: 15_000 });
  const strict = (await page.locator("#membId").count()) > 0 && (await page.locator("#password").count()) > 0;
  const idInput = strict ? page.locator("#membId") : page.locator('input[type="text"], input:not([type])').first();
  const pwInput = strict ? page.locator("#password") : page.locator('input[type="password"]').first();
  await idInput.fill(id);
  await pwInput.fill(pw);
  const responseP = page
    .waitForResponse((r) => /\/loginPopProc\.do/i.test(r.url()) && r.request().method() === "POST", { timeout: responseTimeoutMs })
    .catch(() => null);
  const button = page.locator(".login_btn").first();
  if (strict && (await button.count()) > 0) await button.click();
  else await pwInput.press("Enter");
  // 예전 화면(범용 셀렉터)은 다른 주소로 폼을 낼 수 있다 — 응답과 화면 이동 중 먼저 오는 쪽으로 본다.
  const response = strict
    ? await responseP
    : await Promise.race([responseP, page.waitForURL((u) => isLoggedInUrl(u.toString(), base), { timeout: responseTimeoutMs }).then(() => null, () => null)]);
  let json = null;
  if (response) {
    try {
      json = JSON.parse(await response.text());
    } catch {
      json = null;
    }
  }
  if (json == null && response && strict) {
    // 응답은 왔는데 본문을 못 읽었다 — makeedu 화면은 OK·재인증·결제·다른 요금제면 **곧바로 다른 화면으로 옮겨** 브라우저가 본문을 버린다.
    // 옮겨 간 곳으로 판정한다(화면의 submitHandler와 같은 대응표). login.do에 그대로면 판정 불가.
    await page
      .waitForURL((u) => {
        try {
          const x = new URL(u.toString());
          return x.origin !== new URL(base).origin || !/\/login\.do(?:[;?#]|$)/i.test(x.pathname);
        } catch {
          return false;
        }
      }, { timeout: 10_000 })
      .catch(() => {});
    const moved = resultFromUrl(page.url(), base);
    if (moved) json = { result: moved };
  }
  if (json == null) {
    // 응답 JSON을 못 잡았다 — 예전 화면(다른 주소로 폼 제출·이동)이면 주소로만 판정한다. 그래도 모르면 '판정 불가'(멈추지 않음).
    if (!strict) {
      await page.waitForURL((u) => isLoggedInUrl(u.toString(), base), { timeout: 10_000 }).catch(() => {});
      if (isLoggedInUrl(page.url(), base)) return classifyLoginResult({ result: "OK" });
    }
    return classifyLoginResult(response ? {} : null);
  }
  const result = classifyLoginResult(json);
  if (!result.ok) return result;
  // OK → 화면이 locationUrl로 옮긴다. 메인(로그인 계열이 아닌 화면)에 닿았는지 확인한다.
  await page.waitForURL((u) => isLoggedInUrl(u.toString(), base), { timeout: 20_000 }).catch(() => {});
  if (isLoggedInUrl(page.url(), base)) return result;
  return { ok: null, code: "OK_NO_MAIN", message: "makeedu가 로그인을 받아들였지만 메인 화면으로 넘어가지 않았습니다(판정 불가)", blockAuto: false, remaining: null };
}

let attempted = false; // 한 프로세스(= 한 실행)에서 ID/PW 제출은 한 번뿐

/**
 * makeedu에 로그인된 `{ctx, page, via}`를 연다.
 *   ① 저장 세션으로 main.do 확인 → 살아 있으면 그대로 쓰고 세션 파일을 원자적으로 갱신(via 'session').
 *   ② 죽었으면 자동 로그인 멈춤 표시 확인 → 같은 자격이면 **로그인하지 않고** 멈춤 사유로 실패.
 *   ③ ID/PW로 한 번 로그인 → 성공하면 세션·로그인 시각 저장 + 멈춤 표시 지움(via 'login') ·
 *      OK가 아니면 멈춤 표시를 남기고 실패 · 판정 불가면 표시 없이 실패.
 * 실패는 전부 `MakeeduLoginError`(한 줄 한글 문구 · 아이디 없음).
 */
/**
 * ① 저장 세션 점검 — 정기 실행(openMakeeduContext)과 사람 로그인 직후의 headless 재사용 확인(human-login)이 **같은 함수**를 쓴다.
 * 세션 파일(없으면 옛 MAKEEDU_STORAGE_STATE)로 이 브라우저에 컨텍스트를 열고 main.do를 한 번 연다.
 *   → { state: 'alive', ctx, page, source } 살아 있음(세션 파일을 원자적으로 다시 저장 · ctx는 호출한 쪽이 쓰거나 닫는다)
 *   → { state: 'dead', source }              로그인 화면으로 튕김·로그인 폼(끊긴 걸 처음 알면 수명 한 줄 — noteDead:false면 생략)
 *   → { state: 'none' }                      저장 세션 없음
 *   접속 자체가 실패하면 MakeeduLoginError(SESSION_CHECK_FAILED · 판정 불가)를 던진다.
 */
async function probeStoredSession(browser, { sessionFile = defaultSessionFile(), env = process.env, base = BASE, contextOptions = {}, log = () => {}, noteDead = true } = {}) {
  const { storage, source } = loadStorage(sessionFile, env, log);
  if (!storage) return { state: "none" };
  const ctx = await browser.newContext({ ...contextOptions, storageState: storage });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/main.do`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (e) {
    await ctx.close().catch(() => {});
    // 네트워크·사이트 문제로 세션도 못 봤다 — 이 상태로 ID/PW를 보내지 않는다(판정 불가).
    throw new MakeeduLoginError({ ok: null, code: "SESSION_CHECK_FAILED", message: `makeedu 접속 확인 실패(네트워크·사이트 문제일 수 있음 — 판정 불가): ${String(e.message || e).split("\n")[0].slice(0, 120)}` });
  }
  // 로그인된 화면인가 — 주소(로그인 계열·루트가 아님) + 로그인 폼이 아님(사람 창의 confirmLoggedIn과 같은 기준).
  const loggedIn =
    isLoggedInUrl(page.url(), base) &&
    (await page.locator('form[action*="loginPopProc"], script[src*="login-bot-check"]').count().catch(() => 0)) === 0;
  if (loggedIn) {
    try {
      await saveSession(ctx, sessionFile, base);
    } catch (e) {
      log(`⚠️ 세션 파일 갱신 실패(계속 진행): ${e.code || e.message}`);
    }
    return { state: "alive", ctx, page, source };
  }
  await ctx.close().catch(() => {});
  if (noteDead && source === "file") noteSessionDead(sessionFile, { log }); // 세션 수명 — 처음 알았을 때 한 줄
  return { state: "dead", source };
}

async function openMakeeduContext(browser, { sessionFile = defaultSessionFile(), env = process.env, base = BASE, contextOptions = {}, log = (m) => console.log(m) } = {}) {
  const probe = await probeStoredSession(browser, { sessionFile, env, base, contextOptions, log });
  if (probe.state === "alive") {
    log(`session reuse ok → ${probe.page.url().slice(0, 60)}`);
    return { ctx: probe.ctx, page: probe.page, via: "session" };
  }
  if (probe.state === "dead") log(`저장 세션이 만료됐습니다(${probe.source === "env" ? "MAKEEDU_STORAGE_STATE" : "세션 파일"}) — ID/PW 로그인 확인`);

  const id = env.MAKEEDU_ID;
  const pw = env.MAKEEDU_PW;
  if (!id || !pw)
    throw new MakeeduLoginError({ ok: false, code: "NO_CREDENTIALS", message: "저장된 세션이 없거나 만료됐고 MAKEEDU_ID / MAKEEDU_PW도 없습니다" });

  const block = readBlock(sessionFile);
  if (blockApplies(block, id, pw))
    throw new MakeeduLoginError({ ok: false, code: block.code, message: block.message, blockAuto: true, remaining: block.remaining, readError: block.readError === true }, { blocked: true, at: block.at });
  if (block) log("자격이 바뀌어 자동 로그인을 한 번 다시 시도합니다(멈춤 표시는 다른 자격 기준)");

  if (attempted) throw new MakeeduLoginError({ ok: null, code: "ALREADY_ATTEMPTED", message: "이 실행에서 이미 한 번 로그인을 시도했습니다(재시도 안 함)" });
  attempted = true;

  const ctx = await browser.newContext(contextOptions);
  const page = await ctx.newPage();
  // 경합(리뷰 9a · 재리뷰 경미 1) — 이 시도 중에 사람 로그인이 세션을 저장했는지 보려고 시도 직전의 '판'을 기억한다(시각 앞뒤가 아니라 바뀌었나).
  const markBefore = sessionMark(sessionFile);
  let result;
  try {
    result = await submitLogin(page, { id, pw, base });
  } catch (e) {
    await ctx.close().catch(() => {});
    throw new MakeeduLoginError({ ok: null, code: "LOGIN_PAGE_ERROR", message: `makeedu 로그인 화면 처리 실패(네트워크·사이트 문제일 수 있음 — 판정 불가): ${String(e.message || e).split("\n")[0].slice(0, 120)}` });
  }
  if (result.ok) {
    try {
      await saveSession(ctx, sessionFile, base);
      writeMeta(sessionFile, "idpw");
      clearBlock(sessionFile); // 자격이 맞다는 증거 — 갈래와 상관없이 지운다
    } catch (e) {
      log(`⚠️ 세션 저장 실패(이번 실행은 계속): ${e.code || e.message}`);
    }
    log(`login ok → ${page.url().slice(0, 60)}`);
    return { ctx, page, via: "login" };
  }
  await ctx.close().catch(() => {});
  let blockNote = null;
  if (result.blockAuto) {
    if (sessionChangedSince(sessionFile, markBefore)) {
      // 이 시도 중에 사람이 'makeedu 다시 로그인'으로 세션을 저장했다 — 그 위에 멈춤을 덮으면 사람이 푼 것을 되돌린다(리뷰 9a).
      blockNote = "human_saved";
      log("그 사이 사람 로그인 세션이 저장돼 자동 로그인 멈춤 표시는 남기지 않습니다");
    } else {
      let stored = null;
      try {
        stored = writeBlock(sessionFile, result, id, pw).stored;
      } catch {
        stored = null;
      }
      if (stored === "fallback") {
        blockNote = "fallback";
        log("⚠️ 자동 로그인 멈춤 표시를 본 파일에 못 남겨 예비 파일(login-blocked.alt.json)에 남겼습니다");
      } else if (!stored) {
        blockNote = "write_failed";
        console.error(
          "🔴🔴 자동 로그인 멈춤 표시를 남기지 못했습니다(본·예비 파일 모두) — 다음 실행이 같은 자격으로 ID/PW를 다시 시도할 수 있습니다(계정 잠김 위험). 상태 폴더의 쓰기 권한·백신을 확인해 주세요.",
        );
      }
    }
  }
  // 사람 로그인과 겹쳤으면 이 실패로 벨을 울리지 않게 판정 불가(ok:null)로 — 다음 실행은 사람이 저장한 세션을 쓴다.
  const thrown = blockNote === "human_saved" ? { ...result, ok: null } : result;
  throw new MakeeduLoginError(thrown, { blockNote: blockNote === "fallback" ? null : blockNote });
}

/**
 * 세션 '판'(순수에 가까움 · 파일 상태만 읽는다) — { file: '수정 시각:크기' | null(없음), loggedInAt: session-meta의 로그인 시각 | null }.
 * 경합 판정은 이 판이 **바뀌었나**만 본다 — 수정 시각을 지금 시각과 비교하지 않으므로 시계가 뒤로 가거나 파일 시각이 미래여도
 * 사람 로그인이 없으면 '그 사이 저장됨'으로 잘못 보지 않는다(재리뷰 경미 1 — 그러면 멈춤을 안 남겨 실행마다 ID/PW를 보냈다).
 */
function sessionMark(sessionFile) {
  let file = null;
  try {
    const st = fs.statSync(sessionFile);
    file = `${st.mtimeMs}:${st.size}`;
  } catch {
    file = null;
  }
  return { file, loggedInAt: readMeta(sessionFile)?.loggedInAt ?? null };
}

/** 시도 직전 판(before) 뒤로 누가 세션을 새로 저장했나 — 세션 파일이 있고 판이 바뀌었거나, 로그인 시각이 새로 적혔으면 true. 파일이 사라진 것은 저장이 아니다. */
function sessionChangedSince(sessionFile, before) {
  const now = sessionMark(sessionFile);
  return (now.file !== null && now.file !== before.file) || (now.loggedInAt !== null && now.loggedInAt !== before.loggedInAt);
}

module.exports = {
  BASE,
  HUMAN_ACTION,
  HUMAN_BLOCK_CODES,
  PASSWORD_BLOCK_CODES,
  isHumanBlock,
  blockFamily,
  codeHeadline,
  leftLoginPages,
  confirmLoggedIn,
  probeStoredSession,
  filterStorageForSite,
  blockFallbackOf,
  sessionMark,
  sessionChangedSince,
  clearHumanBlock,
  BLOCK_UNREADABLE,
  sessionStatusLine,
  sessionStateAfterProbe,
  classifyLoginResult,
  credHash,
  blockApplies,
  isLoggedInUrl,
  resultFromUrl,
  loginErrorMessage,
  notificationTextFor,
  MakeeduLoginError,
  defaultSessionFile,
  blockFileOf,
  metaFileOf,
  deadMarkFileOf,
  formatAge,
  sessionLifetimeLine,
  noteSessionDead,
  writeAtomic,
  readBlock,
  writeBlock,
  clearBlock,
  writeMeta,
  readMeta,
  saveSession,
  loadStorage,
  submitLogin,
  openMakeeduContext,
  _resetAttemptForTest: () => {
    attempted = false;
  },
};
