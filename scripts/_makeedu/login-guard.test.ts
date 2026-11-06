// @vitest-environment node
/**
 * login-guard.cjs — makeedu 로그인 한 벌(2026-11-06 사람 확인 대응).
 *
 * ① 순수 함수: 응답 분류 · 자격 지문 · 멈춤 표시 · 로그인된 주소 · 오류/벨 문구.
 * ② 로컬 서버 + 픽스처(fixtures/makeedu-login — makeedu login.html 사본의 jsessionid·token·pid·sitekey를 가짜로 바꾼 것 +
 *    login-bot-check.js 사본 + 최소 jQuery 대역)로 submitLogin·openMakeeduContext·runHumanLogin을 실제 브라우저로 돈다.
 *    🔴 makeedu에는 아무 요청도 보내지 않는다 — 127.0.0.1 밖으로 나가는 요청은 막고 센다. 브라우저가 없으면 ②는 건너뛴다.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
type Result = { ok: boolean | null; code: string; message: string; blockAuto: boolean; remaining: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = require_("./login-guard.cjs") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const H = require_("./human-login.cjs") as any;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "makeedu-login-guard-"));
const deadStorageShape = () => ({ cookies: [{ name: "JSESSIONID", value: "expired", domain: "127.0.0.1", path: "/" }], origins: [] });

describe("classifyLoginResult — makeedu login.html의 결과 처리 목록 + CAPTCHA_REQUIRED", () => {
  it("OK만 성공 · 막지 않는다", () => {
    expect(G.classifyLoginResult({ result: "OK", locationUrl: "/main.do" })).toMatchObject({ ok: true, code: "OK", blockAuto: false });
  });
  it("CAPTCHA_REQUIRED — 사람 확인 · 자동 로그인 멈춤", () => {
    const r: Result = G.classifyLoginResult({ result: "CAPTCHA_REQUIRED" });
    expect(r).toMatchObject({ ok: false, code: "CAPTCHA_REQUIRED", blockAuto: true });
    expect(r.message).toBe("makeedu가 자동 로그인에 사람 확인을 요구합니다 — 동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'이 필요합니다");
  });
  it("NO_LOGIN_CNT — 남은 횟수를 문구에 넣는다(계정 잠김 위험)", () => {
    const r: Result = G.classifyLoginResult({ result: "NO_LOGIN_CNT", result_cnt: "3" });
    expect(r).toMatchObject({ ok: false, code: "NO_LOGIN_CNT", blockAuto: true, remaining: 3 });
    expect(r.message).toContain("남은 시도 3회");
    expect(G.classifyLoginResult({ result: "NO_LOGIN_CNT" }).message).toContain("남은 시도 횟수 모름");
    expect(G.classifyLoginResult({ result: "NO_LOGIN_CNT", result_cnt: -1 }).remaining).toBeNull();
  });
  it.each(["NOK", "NO_CHK", "NO_REJECT", "NO_PTYPE", "NO_PASS", "NOK_LIMIT", "SOMETHING_NEW"])("%s — OK가 아니면 전부 멈춤", (code) => {
    const r: Result = G.classifyLoginResult({ result: code });
    expect(r).toMatchObject({ ok: false, code, blockAuto: true });
    expect(r.message).toMatch(/^makeedu/);
  });
  it("이상한 결과 문자열은 코드로 옮기지 않는다", () => {
    expect(G.classifyLoginResult({ result: "<script>" }).code).toBe("UNKNOWN");
  });
  it("응답 없음·해석 불가는 판정 불가(ok:null) · 멈추지 않는다", () => {
    expect(G.classifyLoginResult(null)).toMatchObject({ ok: null, code: "NO_RESPONSE", blockAuto: false });
    expect(G.classifyLoginResult({})).toMatchObject({ ok: null, code: "BAD_RESPONSE", blockAuto: false });
    expect(G.classifyLoginResult("OK")).toMatchObject({ ok: null, blockAuto: false });
  });
});

describe("자격 지문 · 멈춤 표시 · 주소 판정", () => {
  it("credHash — 솔트 붙인 scrypt(hex 32자) · 솔트가 다르면 같은 자격도 다른 지문 · 구분자 포함 · 솔트 없으면 거부", () => {
    const salt = "00112233445566778899aabbccddeeff";
    const h = G.credHash("fixture-id", "fixture-pw", salt);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(G.credHash("fixture-id", "fixture-pw", salt)).toBe(h);
    expect(G.credHash("fixture-id", "fixture-pw2", salt)).not.toBe(h);
    expect(G.credHash("fixture-id", "fixture-pw", "ffeeddccbbaa99887766554433221100")).not.toBe(h); // 솔트 → 같은 비밀번호도 표시마다 다른 지문
    expect(G.credHash("ab", "c", salt)).not.toBe(G.credHash("a", "bc", salt));
    // 솔트 없는 단순 해시와 다르다(사전 대입·미리 계산한 표로 되돌리기 어렵게)
    const crypto = require_("node:crypto") as typeof import("node:crypto");
    expect(h).not.toBe(crypto.createHash("sha256").update("fixture-id\0fixture-pw").digest("hex").slice(0, 32));
    expect(() => G.credHash("i", "p")).toThrow(/솔트/);
  });
  it("blockApplies — 같은 자격만 막는다(표시에 적힌 솔트로 다시 계산) · 지문·솔트 없는(깨진) 표시는 안전하게 막는다", () => {
    const credSalt = "0123456789abcdef0123456789abcdef";
    const block = { code: "CAPTCHA_REQUIRED", credSalt, credHash: G.credHash("i", "p", credSalt) };
    expect(G.blockApplies(block, "i", "p")).toBe(true);
    expect(G.blockApplies(block, "i", "p2")).toBe(false);
    expect(G.blockApplies(null, "i", "p")).toBe(false);
    expect(G.blockApplies({ code: "UNKNOWN", credHash: null, credSalt: null }, "i", "p")).toBe(true);
    expect(G.blockApplies({ code: "X", credHash: "zz", credSalt }, "i", "p")).toBe(true); // 모양이 이상한 지문 — 멈춘 쪽
  });
  it("isLoggedInUrl — 로그인 계열·다른 사이트·루트는 로그인된 화면이 아니다", () => {
    const B = "https://school.makeedu.co.kr";
    expect(G.isLoggedInUrl(`${B}/main.do`, B)).toBe(true);
    expect(G.isLoggedInUrl(`${B}/member/student/list.do`, B)).toBe(true);
    for (const p of ["/login.do", "/login.do;jsessionid=ABC", "/loginReCert.do", "/loginUsePay.do?membId=x", "/loginPopProc.do", "/findId.do", "/", ""])
      expect(G.isLoggedInUrl(`${B}${p}`, B), p).toBe(false);
    expect(G.isLoggedInUrl("https://lite.makeedu.co.kr/main.do", B)).toBe(false);
    expect(G.isLoggedInUrl("about:blank", B)).toBe(false);
  });
  it("주소 판정 — 경로에 login·logout(대소문자 무시)이 있으면 로그인 안 됨 · 사람 창 '벗어남'은 루트 포함", () => {
    const B = "https://school.makeedu.co.kr";
    for (const p of ["/logout.do", "/member/LoginHistory.do", "/sso/LOGIN", "/loginReCert.do"]) expect(G.isLoggedInUrl(`${B}${p}`, B), p).toBe(false);
    expect(G.leftLoginPages(`${B}/`, B)).toBe(true); // 루트도 벗어남(확인 대상) — 성공은 확인이 정한다
    expect(G.leftLoginPages(`${B}/main.do`, B)).toBe(true);
    expect(G.leftLoginPages(`${B}/error.do`, B)).toBe(true);
    for (const p of ["/login.do", "/loginReCert.do", "/logout.do", "/findId.do"]) expect(G.leftLoginPages(`${B}${p}`, B), p).toBe(false);
    expect(G.leftLoginPages("https://www.google.com/recaptcha/api2/anchor", B)).toBe(false);
    expect(G.leftLoginPages("about:blank", B)).toBe(false);
  });
  it("resultFromUrl — 응답 본문을 못 읽었을 때 화면이 옮겨 간 곳으로(login.html 이동 대응표)", () => {
    const B = "https://school.makeedu.co.kr";
    expect(G.resultFromUrl(B + "/main.do", B)).toBe("OK");
    expect(G.resultFromUrl(B + "/loginReCert.do", B)).toBe("NO_REJECT");
    expect(G.resultFromUrl(B + "/loginUsePay.do?membId=x", B)).toBe("NOK_LIMIT");
    expect(G.resultFromUrl("https://lite.makeedu.co.kr/", B)).toBe("NO_PTYPE");
    expect(G.resultFromUrl("https://free.makeedu.co.kr", B)).toBe("NO_PTYPE");
    expect(G.resultFromUrl(B + "/login.do;jsessionid=X", B)).toBeNull();
    expect(G.resultFromUrl("https://example.com/main.do", B)).toBeNull();
    expect(G.resultFromUrl("about:blank", B)).toBeNull();
  });
  it("세션 수명 한 줄 — 세션 저장 후·로그인 후 · 같은 세션 파일이면 처음 한 번만", () => {
    const now = Date.parse("2026-11-07T06:00:00Z");
    expect(G.formatAge(5 * 60_000)).toBe("5분");
    expect(G.formatAge(26 * 3600_000 + 7 * 60_000)).toBe("26시간 7분");
    expect(G.formatAge(-1)).toBe("알 수 없음");
    expect(G.sessionLifetimeLine({ savedAtMs: now - 3 * 3600_000, now })).toBe("makeedu 세션 수명 — 저장 세션이 끊긴 것을 처음 확인: 세션 저장 후 3시간 0분(마지막 정상 확인 때 저장)");
    expect(G.sessionLifetimeLine({ savedAtMs: now - 3 * 3600_000, meta: { loggedInAt: "2026-11-06T04:30:00Z", method: "human" }, now })).toContain("로그인 후 25시간 30분(사람 로그인)");
    const dir = tmp();
    const sessionFile = path.join(dir, "session.json");
    try {
      const lines: string[] = [];
      const log = (m: string) => lines.push(m);
      expect(G.noteSessionDead(sessionFile, { log })).toBeNull(); // 세션 파일 없음
      fs.writeFileSync(sessionFile, JSON.stringify({ cookies: [{ name: "JSESSIONID", value: "secret-cookie" }] }));
      expect(G.noteSessionDead(sessionFile, { log })).toMatch(/^makeedu 세션 수명/);
      expect(G.noteSessionDead(sessionFile, { log })).toBeNull();
      expect(lines.length).toBe(1);
      expect(lines[0]).not.toContain("secret-cookie");
      expect(fs.readFileSync(G.deadMarkFileOf(sessionFile), "utf8")).not.toContain("secret-cookie");
      fs.writeFileSync(sessionFile, JSON.stringify({ cookies: [{ name: "JSESSIONID", value: "other-cookie-longer" }] })); // 새 세션(판이 바뀜)
      expect(G.noteSessionDead(sessionFile, { log })).not.toBeNull();
      expect(lines.length).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("멈춤 갈래 — 사람 확인 계열(CAPTCHA·재인증)만 사람 로그인으로 지우고, 비밀번호·계정 계열은 남긴다", () => {
    expect(G.HUMAN_BLOCK_CODES).toEqual(["CAPTCHA_REQUIRED", "NO_REJECT"]);
    const dir = tmp();
    const sessionFile = path.join(dir, "session.json");
    try {
      expect(G.clearHumanBlock(sessionFile)).toBeNull(); // 표시 없음
      for (const result of ["CAPTCHA_REQUIRED", "NO_REJECT"]) {
        G.writeBlock(sessionFile, G.classifyLoginResult({ result }), "i", "p");
        expect(G.clearHumanBlock(sessionFile), result).toBeNull();
        expect(G.readBlock(sessionFile), result).toBeNull();
      }
      for (const result of ["NO_LOGIN_CNT", "NOK", "NO_CHK", "NO_PASS", "NO_PTYPE", "NOK_LIMIT", "SOMETHING_NEW"]) {
        G.writeBlock(sessionFile, G.classifyLoginResult({ result }), "i", "p");
        expect(G.clearHumanBlock(sessionFile), result).toBe(result);
        expect(G.readBlock(sessionFile)?.code, result).toBe(result); // 남는다 — 계정을 다시 저장해야 풀린다
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("하루 1번 점검의 세션 상태 한 줄 — 살아 있음/끊김 · 로그인 후 N시간 · 점검 결과 → 상태", () => {
    const now = Date.parse("2026-11-07T23:30:00Z");
    const meta = { loggedInAt: "2026-11-06T21:30:00Z", method: "human" };
    expect(G.sessionStatusLine({ state: "alive", meta, now })).toBe("makeedu 세션 살아 있음 — 로그인 후 26시간 0분(사람 로그인)");
    expect(G.sessionStatusLine({ state: "dead", meta: { ...meta, method: "idpw" }, now })).toBe("makeedu 세션 끊김 — 로그인 후 26시간 0분(ID/PW 로그인)");
    expect(G.sessionStatusLine({ state: "alive", meta: null, now })).toBe("makeedu 세션 살아 있음 — 로그인 시각 기록 없음");
    expect(G.sessionStatusLine({ state: "none", meta, now })).toBe("makeedu 저장 세션 없음");
    expect(G.sessionStatusLine({ state: "unknown", meta, now })).toBe("makeedu 세션 확인 못 함(판정 불가)");
    const S = G.sessionStateAfterProbe;
    expect(S({ hadSession: true, via: "session", ok: true })).toBe("alive");
    expect(S({ hadSession: true, via: "login", ok: true })).toBe("dead"); // 끊겨서 ID/PW로 새로 들어감
    expect(S({ hadSession: false, via: "login", ok: true })).toBe("none");
    expect(S({ hadSession: true, ok: false, errorCode: "CAPTCHA_REQUIRED" })).toBe("dead");
    expect(S({ hadSession: true, ok: null, errorCode: "NO_RESPONSE" })).toBe("dead");
    expect(S({ hadSession: true, ok: null, errorCode: "SESSION_CHECK_FAILED" })).toBe("unknown"); // 네트워크 — 끊겼다고 하지 않는다
    expect(S({ hadSession: true, ok: null, errorCode: "SESSION_READ_FAILED" })).toBe("unknown"); // 세션 파일 잠김 — 끊겼다고 하지 않는다
    expect(S({ hadSession: true, ok: null, errorCode: null })).toBe("unknown");
    expect(S({ hadSession: false, ok: false, errorCode: "NO_CREDENTIALS" })).toBe("none");
  });
  it("본·예비 표시가 둘 다 있으면 사람 로그인은 파일마다 갈래를 본다 — 사람 확인 파일만 지우고 비밀번호·계정·읽지 못한 파일은 남긴다(재리뷰 경미 2)", () => {
    const dir = tmp();
    const sessionFile = path.join(dir, "session.json");
    const put = (file: string, code: string, at: string) => fs.writeFileSync(file, JSON.stringify({ code, message: "m", at, credSalt: "0".repeat(32), credHash: "1".repeat(32) }));
    const main = G.blockFileOf(sessionFile);
    const alt = G.blockFallbackOf(sessionFile);
    try {
      // 본(CAPTCHA · 옛) + 예비(NO_LOGIN_CNT · 새) — 읽기는 더 최근인 예비 · 사람 로그인은 본(사람 확인)만 지우고 비밀번호 멈춤을 돌려준다
      put(main, "CAPTCHA_REQUIRED", "2026-11-05T21:00:00.000Z");
      put(alt, "NO_LOGIN_CNT", "2026-11-06T00:00:00.000Z");
      expect(G.readBlock(sessionFile)).toMatchObject({ code: "NO_LOGIN_CNT", fallback: true });
      expect(G.clearHumanBlock(sessionFile)).toBe("NO_LOGIN_CNT");
      expect([fs.existsSync(main), fs.existsSync(alt)]).toEqual([false, true]);
      // 거꾸로 — 본(NO_LOGIN_CNT · 옛) + 예비(CAPTCHA · 새): 예전엔 고른 쪽이 사람 확인이라 둘 다 지워 비밀번호 멈춤이 사라졌다
      fs.rmSync(alt);
      put(main, "NO_LOGIN_CNT", "2026-11-05T21:00:00.000Z");
      put(alt, "CAPTCHA_REQUIRED", "2026-11-06T00:00:00.000Z");
      expect(G.readBlock(sessionFile)).toMatchObject({ code: "CAPTCHA_REQUIRED", fallback: true });
      expect(G.clearHumanBlock(sessionFile)).toBe("NO_LOGIN_CNT");
      expect([fs.existsSync(main), fs.existsSync(alt)]).toEqual([true, false]);
      // 읽지 못한 본 + 사람 확인 예비 — 예비만 지우고, 읽지 못한 표시는 남아 계속 막는다
      fs.writeFileSync(main, "{broken");
      put(alt, "NO_REJECT", "2026-11-06T00:00:00.000Z");
      expect(G.clearHumanBlock(sessionFile)).toBe("BLOCK_UNREADABLE");
      expect([fs.existsSync(main), fs.existsSync(alt)]).toEqual([true, false]);
      // 둘 다 사람 확인 — 둘 다 지운다
      put(main, "CAPTCHA_REQUIRED", "2026-11-05T21:00:00.000Z");
      put(alt, "NO_REJECT", "2026-11-06T00:00:00.000Z");
      expect(G.clearHumanBlock(sessionFile)).toBeNull();
      expect(G.readBlock(sessionFile)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("경합 판정은 세션 '판'이 바뀌었나로(재리뷰 경미 1) — 시각 앞뒤를 보지 않는다 · 로그인 시각만 바뀌어도 · 파일이 사라진 건 저장이 아니다", () => {
    const dir = tmp();
    const sessionFile = path.join(dir, "session.json");
    try {
      const none = G.sessionMark(sessionFile);
      expect(none).toEqual({ file: null, loggedInAt: null });
      expect(G.sessionChangedSince(sessionFile, none)).toBe(false);
      fs.writeFileSync(sessionFile, JSON.stringify(deadStorageShape()));
      expect(G.sessionChangedSince(sessionFile, none)).toBe(true); // 없던 세션이 생김
      // 파일 시각이 미래(시계가 뒤로 감)여도 그대로면 '바뀜' 아님
      const future = new Date(Date.now() + 3_600_000);
      fs.utimesSync(sessionFile, future, future);
      const before = G.sessionMark(sessionFile);
      expect(G.sessionChangedSince(sessionFile, before)).toBe(false);
      // 다시 저장(사람 로그인 흉내 — 시각을 과거로 돌려도) → 바뀜
      fs.writeFileSync(sessionFile, JSON.stringify({ cookies: [{ name: "JSESSIONID", value: "new-session-value" }], origins: [] }));
      const past = new Date(Date.now() - 3_600_000);
      fs.utimesSync(sessionFile, past, past);
      expect(G.sessionChangedSince(sessionFile, before)).toBe(true);
      // 로그인 시각만 새로 적힘 → 바뀜
      const mark2 = G.sessionMark(sessionFile);
      G.writeMeta(sessionFile, "human");
      expect(G.sessionChangedSince(sessionFile, mark2)).toBe(true);
      // 파일이 사라짐 → 저장이 아니다
      const mark3 = G.sessionMark(sessionFile);
      fs.rmSync(sessionFile);
      expect(G.sessionChangedSince(sessionFile, mark3)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("멈춤 표시 파일 — 비밀번호 원문 없음 · 읽기·지우기 · 깨지면 BLOCK_UNREADABLE(멈춘 쪽 · makeedu 모르는 응답과 구분)", () => {
    const dir = tmp();
    const sessionFile = path.join(dir, "session.json");
    try {
      expect(G.readBlock(sessionFile)).toBeNull();
      G.writeBlock(sessionFile, G.classifyLoginResult({ result: "NO_LOGIN_CNT", result_cnt: 2 }), "fixture-id", "fixture-secret-pw");
      const text = fs.readFileSync(G.blockFileOf(sessionFile), "utf8");
      expect(text).not.toContain("fixture-secret-pw");
      expect(text).not.toContain("fixture-id");
      const saved = G.readBlock(sessionFile);
      expect(saved).toMatchObject({ code: "NO_LOGIN_CNT", remaining: 2 });
      expect(saved.credSalt).toMatch(/^[0-9a-f]{32}$/);
      expect(saved.credHash).toBe(G.credHash("fixture-id", "fixture-secret-pw", saved.credSalt));
      expect(G.blockApplies(saved, "fixture-id", "fixture-secret-pw")).toBe(true);
      expect(G.blockApplies(saved, "fixture-id", "other-pw")).toBe(false);
      // 다시 쓰면 솔트가 새로 — 같은 비밀번호여도 지문이 달라 파일끼리 대조할 수 없다
      G.writeBlock(sessionFile, G.classifyLoginResult({ result: "NO_LOGIN_CNT", result_cnt: 2 }), "fixture-id", "fixture-secret-pw");
      expect(G.readBlock(sessionFile).credHash).not.toBe(saved.credHash);
      fs.writeFileSync(G.blockFileOf(sessionFile), "{broken");
      expect(G.readBlock(sessionFile)).toMatchObject({ code: "BLOCK_UNREADABLE", credHash: null, unreadable: true, readError: false });
      expect(G.blockFamily("BLOCK_UNREADABLE")).toBe("account"); // 사람 로그인으로 안 풀림 · 비밀번호 미리 채우기 안 함
      expect(G.blockApplies(G.readBlock(sessionFile), "fixture-id", "fixture-secret-pw")).toBe(true); // 지문이 없으니 막는다
      G.clearBlock(sessionFile);
      expect(G.readBlock(sessionFile)).toBeNull();
      G.clearBlock(sessionFile); // 없어도 오류 없음
      G.writeMeta(sessionFile, "human");
      expect(G.readMeta(sessionFile)).toMatchObject({ method: "human" });
      expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]); // 원자 쓰기 임시 파일이 남지 않는다
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("loadStorage — 세션 파일 우선 · 옛 MAKEEDU_STORAGE_STATE 호환 · 깨진 파일은 세션 없음", () => {
    const dir = tmp();
    const sessionFile = path.join(dir, "session.json");
    try {
      const env = { MAKEEDU_STORAGE_STATE: JSON.stringify({ cookies: [{ name: "from", value: "env" }], origins: [] }) };
      expect(G.loadStorage(sessionFile, env)).toMatchObject({ source: "env" });
      fs.writeFileSync(sessionFile, JSON.stringify({ cookies: [], origins: [] }));
      expect(G.loadStorage(sessionFile, env)).toMatchObject({ source: "file" });
      fs.writeFileSync(sessionFile, "{broken");
      const logs: string[] = [];
      expect(G.loadStorage(sessionFile, {}, (m: string) => logs.push(m))).toEqual({ storage: null, source: null });
      expect(logs.length).toBe(1);
      expect(() => G.loadStorage(path.join(dir, "none.json"), { MAKEEDU_STORAGE_STATE: "{x" })).toThrow(/MAKEEDU_STORAGE_STATE 파싱 실패/);
      expect(G.defaultSessionFile({ MAKEEDU_SESSION_FILE: "X:/s.json" })).toBe("X:/s.json");
      expect(G.defaultSessionFile({})).toBe(path.resolve(HERE, "..", "..", ".makeedu-tmp", "session.json"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("오류·벨 문구 — 한 줄 · 아이디 없음 · 사유별", () => {
  it("처음 막힘 / 멈춤 표시로 안 함", () => {
    const r = G.classifyLoginResult({ result: "CAPTCHA_REQUIRED" });
    const fresh: string = G.loginErrorMessage(r);
    expect(fresh).toContain("[CAPTCHA_REQUIRED]");
    expect(fresh).toContain("자동 로그인 멈춤");
    const blocked: string = G.loginErrorMessage(r, { blocked: true, at: "2026-11-05T21:00:03.000Z" });
    expect(blocked).toMatch(/^makeedu 자동 로그인 멈춤 \[CAPTCHA_REQUIRED\] — makeedu가 자동 로그인에 사람 확인을/);
    expect(blocked).toContain("2026-11-06 06:00부터");
    for (const m of [fresh, blocked]) {
      expect(m).not.toContain("\n");
      expect(m.length).toBeLessThan(300); // sync-all이 300자로 자른다
    }
    const e = new G.MakeeduLoginError(r, { blocked: true, at: null });
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ ok: false, code: "CAPTCHA_REQUIRED", blocked: true, blockAuto: true });
    expect(new G.MakeeduLoginError(G.classifyLoginResult(null)).ok).toBeNull();
  });
  it("notificationTextFor — 사람 확인 · 비밀번호 틀림(남은 횟수) · 그 밖(기존 문구 그대로)", () => {
    expect(G.notificationTextFor({ code: "CAPTCHA_REQUIRED" }, "2026-11-06")).toEqual({
      title: "makeedu가 사람 확인을 요구합니다",
      body: "makeedu 자동 동기화가 멈췄습니다 — 동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'을 눌러 확인 한 번 해 주세요. (감지 2026-11-06)",
    });
    // 비밀번호 계열 — makeedu 원문 '로그인 정보가 올바르지 않습니다' + 남은 횟수 · 비밀번호 확인해 다시 저장
    expect(G.notificationTextFor({ code: "NO_LOGIN_CNT", remaining: 2 }, "2026-11-06")).toEqual({
      title: "makeedu 로그인 정보가 올바르지 않습니다(남은 시도 2회)",
      body: "makeedu 자동 동기화가 멈췄습니다 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 확인해 다시 저장해 주세요 — 저장하면 자동 로그인이 풀립니다(더 틀리면 계정이 잠길 수 있습니다). (감지 2026-11-06)",
    });
    expect(G.notificationTextFor({ code: "NO_LOGIN_CNT", remaining: null }, "2026-11-06").title).toBe("makeedu 로그인 정보가 올바르지 않습니다");
    expect(G.notificationTextFor({ code: "NO_CHK" }, "2026-11-06").title).toBe("makeedu 인증정보가 올바르지 않습니다");
    // 재인증(NO_REJECT)은 사람 확인과 같은 벨
    expect(G.notificationTextFor({ code: "NO_REJECT" }, "2026-11-06")).toEqual(G.notificationTextFor({ code: "CAPTCHA_REQUIRED" }, "2026-11-06"));
    // 계정 계열 — 원인 제목 + makeedu에서 해결 → 비밀번호 한 번 더 저장(같은 값이어도)
    const ACCT_BODY = "makeedu 자동 동기화가 멈췄습니다 — makeedu에서 해결한 뒤 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다. (감지 2026-11-06)";
    const titles: Record<string, string> = {
      NOK: "makeedu 계정이 미인증 상태입니다",
      NO_PASS: "makeedu 호출정보가 올바르지 않습니다",
      NO_PTYPE: "makeedu가 이 계정을 무료형·실속형(라이트) 사용자로 안내합니다",
      NOK_LIMIT: "makeedu가 사용 기한·결제 화면으로 안내합니다",
      SOMETHING_NEW: "makeedu가 알 수 없는 응답(SOMETHING_NEW)으로 로그인을 거절했습니다",
    };
    for (const [code, title] of Object.entries(titles)) expect(G.notificationTextFor({ code }, "2026-11-06"), code).toEqual({ title, body: ACCT_BODY });
    // makeedu가 이상한 결과 문자열을 보내 UNKNOWN이 된 경우는 여전히 'makeedu가 알 수 없는 응답으로 거절'
    expect(G.notificationTextFor({ code: "UNKNOWN" }, "2026-11-06").title).toBe("makeedu가 알 수 없는 응답(UNKNOWN)으로 로그인을 거절했습니다");
    // 동기화 PC의 멈춤 기록을 읽지 못함(재리뷰 경미 4) — makeedu가 거절한 게 아니다 · makeedu에서 해결할 일 없음
    const unreadable = G.notificationTextFor({ code: "BLOCK_UNREADABLE" }, "2026-11-06");
    expect(unreadable).toEqual({
      title: "동기화 PC의 makeedu 멈춤 기록을 읽지 못했습니다",
      body: "안전을 위해 makeedu 자동 로그인을 멈췄습니다 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다. (감지 2026-11-06)",
    });
    expect(JSON.stringify(unreadable)).not.toMatch(/알 수 없는 응답|거절|makeedu에서 해결/);
    expect(G.notificationTextFor({ code: "BLOCK_UNREADABLE", readError: false }, "2026-11-06")).toEqual(unreadable); // 내용 깨짐 = 위와 같다
    // 멈춤 기록 파일을 열 수 없음(읽기 자체 실패 · fix4) — 비밀번호 저장으로 안 풀리므로 그 안내 없이 PC 재시작·백신 예외·폴더 권한
    const locked = G.notificationTextFor({ code: "BLOCK_UNREADABLE", readError: true }, "2026-11-06");
    expect(locked).toEqual({
      title: "동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다",
      body: "안전을 위해 makeedu 자동 로그인을 멈춰 두었습니다 — 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다). (감지 2026-11-06)",
    });
    expect(JSON.stringify(locked)).not.toMatch(/비밀번호|연동 계정|알 수 없는 응답|거절/);
    // 내부 코드(자격 없음 등)는 기존 문구 그대로
    for (const code of ["NO_CREDENTIALS", undefined])
      expect(G.notificationTextFor({ code }, "2026-11-06")).toEqual({
        title: "makeedu 접속이 실패했습니다",
        body: "makeedu 동기화가 멈춥니다 — 비밀번호 변경·CAPTCHA·계정 잠금을 확인해 주세요. (감지 2026-11-06)",
      });
  });
  it("코드별 원인 문구(워커) — makeedu 화면 원문 기준 · 갈래별 할 일 · 300자 안", () => {
    const at = "2026-11-05T21:00:03.000Z";
    for (const code of ["NO_LOGIN_CNT", "NO_CHK", "NOK", "NO_PASS", "NO_PTYPE", "NOK_LIMIT", "SOMETHING_NEW_LONG_CODE_NAME_FORTY_CHARS"]) {
      const r = G.classifyLoginResult({ result: code, result_cnt: 3 });
      expect(r.message.startsWith(G.codeHeadline(r.code, r.remaining)), code).toBe(true);
      expect(r.message).toContain(G.blockFamily(r.code) === "password" ? "비밀번호를 확인해 다시 저장해야 자동 로그인이 풀립니다" : "makeedu에서 해결한 뒤");
      expect(`scrape.cjs exited 1 — ${G.loginErrorMessage(r, { blocked: true, at })}`.length, code).toBeLessThan(300);
    }
    expect(G.codeHeadline("NO_LOGIN_CNT", 3)).toBe("makeedu 로그인 정보가 올바르지 않습니다 · 남은 시도 3회");
    // 읽지 못한 멈춤 기록으로 막은 실행의 오류 문구 — 300자 안 · makeedu 거절이라고 하지 않는다
    const dir = tmp();
    try {
      const sessionFile = path.join(dir, "session.json");
      fs.writeFileSync(G.blockFileOf(sessionFile), "{broken");
      const b = G.readBlock(sessionFile);
      const msg = G.loginErrorMessage({ ok: false, code: b.code, message: b.message, blockAuto: true }, { blocked: true, at: b.at });
      expect(msg).toMatch(/^makeedu 자동 로그인 멈춤 \[BLOCK_UNREADABLE\] — 동기화 PC의 makeedu 자동 로그인 멈춤 기록을 읽지 못했습니다 — 안전을 위해/);
      expect(msg).not.toMatch(/알 수 없는 응답|거절/);
      expect(msg).toContain("비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다"); // 내용 깨짐 — 비밀번호 저장으로 풀림
      expect(b).toMatchObject({ unreadable: true, readError: false });
      expect(`scrape.cjs exited 1 — ${msg}`.length).toBeLessThan(300);
      // 파일 읽기 자체 실패(디렉터리라 EISDIR — 잠김·권한 흉내 · fix4) — 같은 코드 · 비밀번호 저장 안내 없음
      fs.rmSync(G.blockFileOf(sessionFile));
      fs.mkdirSync(G.blockFileOf(sessionFile));
      const r = G.readBlock(sessionFile);
      expect(r).toMatchObject({ code: "BLOCK_UNREADABLE", unreadable: true, readError: true, credHash: null });
      expect(G.blockFamily(r.code)).toBe("account"); // 갈래·막기는 그대로
      expect(G.blockApplies(r, "i", "p")).toBe(true);
      const readMsg = G.loginErrorMessage({ ok: false, code: r.code, message: r.message, blockAuto: true }, { blocked: true, at: r.at });
      expect(readMsg).toBe(
        "makeedu 자동 로그인 멈춤 [BLOCK_UNREADABLE] — 동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등) — 안전을 위해 자동 로그인을 멈춰 두었습니다 · 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다) (ID/PW 재시도 안 함)",
      );
      expect(readMsg).not.toMatch(/비밀번호|연동 계정/);
      expect(`scrape.cjs exited 1 — ${readMsg}`.length).toBeLessThan(300);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── 로컬 서버 + 픽스처 브라우저 시험 ──────────────────────────────────────────

const FIX = path.join(HERE, "fixtures", "makeedu-login");
const LOGIN_HTML = fs.readFileSync(path.join(FIX, "login.html"), "utf8");
const BOT = fs.readFileSync(path.join(FIX, "login-bot-check.js"), "utf8");
const SHIM = fs.readFileSync(path.join(FIX, "jquery-shim.js"), "utf8");
// 예전 화면(범용 셀렉터 경로) — #membId/#password가 없고 다른 주소로 폼을 낸다.
const LEGACY_HTML = `<!doctype html><html><body><form method="post" action="/legacy/doLogin"><input type="text" name="uid"><input type="password" name="upw"><button type="submit">로그인</button></form></body></html>`;
// 재인증 화면 대역 — 사람이 '인증 완료'를 누르면 폼 제출 → 서버가 세션을 세우고 메인으로 보낸다.
const RECERT_HTML = `<!doctype html><html><body><p>재인증</p><form method="post" action="/loginReCertProc.do"><button id="fixture-recert-done" type="submit">인증 완료</button></form></body></html>`;

// OK_ROOT = OK인데 locationUrl이 '/'이고 '/'는 리다이렉트 없이 200(주소 가정이 아니라 로그인 확인으로 성공해야 한다).
// OK_JSESSION = locationUrl에 ;jsessionid·쿼리가 붙는다(도착 경로 로그에 세션 값이 새지 않는지).
type Mode = "OK" | "OK_ROOT" | "OK_JSESSION" | "CAPTCHA_REQUIRED" | "NO_LOGIN_CNT" | "NO_REJECT";
const server = {
  mode: "OK" as Mode,
  // main.do 응답 — normal(쿠키 있으면 200 · 없으면 로그인으로 302) · error500(늘 500) · loginform(200인데 로그인 폼) ·
  // formonly(200 · 로그인 폼(form action=loginPopProc)만) · botonly(200 · login-bot-check.js 스크립트만) — 주소는 그대로 /main.do
  mainMode: "normal" as "normal" | "error500" | "loginform" | "formonly" | "botonly",
  mainHits: 0,
  checkHits: 0, // 로그인 확인 GET(브라우저 탐색이 아닌 요청 — sec-fetch-dest 머리글 없음)만
  onPost: null as null | (() => void), // 로그인 제출이 들어온 순간에 끼울 일(경합 시험)
  // UA 묶기 대역(리뷰 13) — 세션을 만든 UA(로그인 제출의 UA)와 다른 UA로 오면 main.do가 로그인으로 튕긴다.
  uaBind: false,
  sessionUA: null as string | null,
  dropHeadless: false, // headless UA의 main.do 요청은 연결을 끊는다(판정 불가 흉내)
  posts: [] as URLSearchParams[],
  legacyPosts: 0,
  requests: [] as string[],
  base: "",
  http: null as http.Server | null,
};
function send(res: http.ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromium: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null;
try {
  ({ chromium } = require_("@playwright/test"));
  browser = await chromium.launch({ headless: true });
} catch {
  browser = null; // Playwright 브라우저가 없는 PC — 브라우저 시험은 건너뛴다
}
const external: string[] = [];
// openMakeeduContext가 쓰는 browser.newContext만 감싸 127.0.0.1 밖 요청을 막고 센다(makeedu·구글 어디에도 안 나간다).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function guard(ctx: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ctx.route("**/*", (route: any) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    external.push(u.hostname);
    return route.abort();
  });
  return ctx;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const guarded = { newContext: async (o?: object) => guard(await browser.newContext(o)) } as any;

beforeAll(async () => {
  server.http = http.createServer((req, res) => {
    const url = req.url || "/";
    server.requests.push(`${req.method} ${url}`);
    if (req.method === "POST" && url.startsWith("/loginPopProc.do")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        server.posts.push(new URLSearchParams(body));
        server.onPost?.();
        if (server.mode === "OK" || server.mode === "OK_ROOT" || server.mode === "OK_JSESSION") {
          server.sessionUA = String(req.headers["user-agent"] || "");
          const locationUrl = server.mode === "OK_ROOT" ? "/" : server.mode === "OK_JSESSION" ? "/main.do;jsessionid=SECRETSESSIONVALUE?from=FIXTUREQUERY" : "/main.do";
          res.writeHead(200, { "content-type": "application/json;charset=UTF-8", "set-cookie": "JSESSIONID=good; Path=/; HttpOnly" });
          res.end(JSON.stringify({ result: "OK", result_cnt: 0, locationUrl, priceType: "" }));
        } else if (server.mode === "NO_REJECT") send(res, 200, "application/json;charset=UTF-8", JSON.stringify({ result: "NO_REJECT" }));
        else if (server.mode === "NO_LOGIN_CNT") send(res, 200, "application/json;charset=UTF-8", JSON.stringify({ result: "NO_LOGIN_CNT", result_cnt: 3 }));
        else send(res, 200, "application/json;charset=UTF-8", JSON.stringify({ result: "CAPTCHA_REQUIRED" }));
      });
      return;
    }
    // 같은 주소의 GET(제출 아님) — 사람 확인 요구 JSON을 돌려줘도 사람 창의 제출 진단이 세지 않아야 한다(재리뷰 경미 5).
    if (req.method === "GET" && url.startsWith("/loginPopProc.do")) return send(res, 200, "application/json;charset=UTF-8", JSON.stringify({ result: "CAPTCHA_REQUIRED" }));
    if (req.method === "POST" && url === "/legacy/doLogin") {
      server.legacyPosts++;
      req.resume();
      res.writeHead(302, { location: "/main.do", "set-cookie": "JSESSIONID=good; Path=/" });
      res.end();
      return;
    }
    // 재인증 화면 대역(진짜 loginReCert.do 화면은 받아 보지 않았다 — 주소만 같다) · '인증 완료'를 사람이 누르면 세션이 서고 메인으로.
    if (url.startsWith("/loginReCert.do")) return send(res, 200, "text/html; charset=utf-8", RECERT_HTML);
    if (req.method === "POST" && url === "/loginReCertProc.do") {
      req.resume();
      res.writeHead(302, { location: "/main.do", "set-cookie": "JSESSIONID=good; Path=/" });
      res.end();
      return;
    }
    if (url.startsWith("/login.do")) return send(res, 200, "text/html; charset=utf-8", LOGIN_HTML);
    if (url.startsWith("/legacy/login.do")) return send(res, 200, "text/html; charset=utf-8", LEGACY_HTML);
    if (url === "/js/jquery/jquery-1.11.3.min.js") return send(res, 200, "application/javascript", SHIM);
    if (url === "/js/login-bot-check.js") return send(res, 200, "application/javascript", BOT);
    if (url.startsWith("/js/")) return send(res, 200, "application/javascript", "");
    if (url.startsWith("/css/")) return send(res, 200, "text/css", "");
    if (url.startsWith("/main.do")) {
      server.mainHits++;
      if (!req.headers["sec-fetch-dest"]) server.checkHits++;
      const ua = String(req.headers["user-agent"] || "");
      if (server.dropHeadless && /HeadlessChrome/.test(ua)) return void req.socket.destroy();
      if (server.uaBind && server.sessionUA && ua !== server.sessionUA) {
        res.writeHead(302, { location: "/login.do" });
        res.end();
        return;
      }
      if (server.mainMode === "error500") return send(res, 500, "text/html; charset=utf-8", "<html><body>오류</body></html>");
      if (server.mainMode === "loginform") return send(res, 200, "text/html; charset=utf-8", LOGIN_HTML);
      if (server.mainMode === "formonly")
        return send(res, 200, "text/html; charset=utf-8", `<html><body><form method="post" action="/loginPopProc.do;jsessionid=FIXTURE"><input id="membId"></form></body></html>`);
      if (server.mainMode === "botonly") return send(res, 200, "text/html; charset=utf-8", `<html><body><script src="/js/login-bot-check.js"></script>메인처럼 보이는 화면</body></html>`);
      if (/(?:^|;\s*)JSESSIONID=good(?:;|$)/.test(req.headers.cookie || "")) return send(res, 200, "text/html; charset=utf-8", "<html><body>메인 화면</body></html>");
      res.writeHead(302, { location: "/login.do" });
      res.end();
      return;
    }
    // 루트 — 리다이렉트 없이 200(로그인돼 있든 아니든). 같은 사이트 오류 화면 · 잠깐 들렀다 로그인으로 되튕기는 화면.
    if (url === "/") return send(res, 200, "text/html; charset=utf-8", "<html><body>루트 화면</body></html>");
    if (url.startsWith("/error.do")) return send(res, 500, "text/html; charset=utf-8", "<html><body>같은 사이트 오류 화면</body></html>");
    if (url.startsWith("/bounce.do")) return send(res, 200, "text/html; charset=utf-8", "<html><body><script>location.replace('/login.do')</script></body></html>");
    send(res, 404, "text/plain", "");
  });
  await new Promise<void>((r) => server.http!.listen(0, "127.0.0.1", () => r()));
  server.base = `http://127.0.0.1:${(server.http!.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((r) => (server.http ? server.http.close(() => r()) : r()));
  expect(external.filter((h) => h !== "www.google.com")).toEqual([]); // 구글은 화면이 사람 확인 칸을 띄우려는 것(막힘)
});
beforeEach(() => {
  server.mode = "OK";
  server.mainMode = "normal";
  server.mainHits = 0;
  server.checkHits = 0;
  server.onPost = null;
  server.uaBind = false;
  server.sessionUA = null;
  server.dropHeadless = false;
  server.posts = [];
  server.legacyPosts = 0;
  server.requests = [];
  G._resetAttemptForTest();
});

const aliveStorage = () => ({
  cookies: [{ name: "JSESSIONID", value: "good", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
});
const deadStorage = () => ({ cookies: [{ ...aliveStorage().cookies[0], value: "expired" }], origins: [] });
const CREDS = { MAKEEDU_ID: "fixture-id", MAKEEDU_PW: "fixture-pw" };

describe.skipIf(!browser)("submitLogin — 픽스처 login.html(가짜 jsessionid·token) · makeedu 화면 스크립트 그대로", () => {
  async function run(mode: Mode) {
    server.mode = mode;
    const ctx = await guarded.newContext();
    const page = await ctx.newPage();
    try {
      const result: Result = await G.submitLogin(page, { id: "fixture-id", pw: "fixture-pw", base: server.base });
      const webdriver = await page.evaluate(() => (navigator.webdriver ? "automation" : "browser")).catch(() => null);
      return { result, url: page.url(), webdriver, humanCheckShown: await page.locator("#login-human-check").isVisible().catch(() => false) };
    } finally {
      await ctx.close();
    }
  }
  it("CAPTCHA_REQUIRED — 한 번만 제출 · 자동화 표시는 화면 스크립트가 채운 값 그대로 · 멈춤 판정", async () => {
    const { result, url, webdriver, humanCheckShown } = await run("CAPTCHA_REQUIRED");
    expect(result).toMatchObject({ ok: false, code: "CAPTCHA_REQUIRED", blockAuto: true });
    expect(server.posts.length).toBe(1);
    const p = server.posts[0];
    expect(p.get("membId")).toBe("fixture-id");
    expect(p.get("password")).toBe("fixture-pw");
    expect(p.get("loginBrowserToken")).toBe("00000000-0000-4000-8000-000000000000");
    expect(p.get("loginBrowserRuntime")).toBe(webdriver); // 우리가 덮지 않는다 — 화면의 login-bot-check.js가 navigator.webdriver로 채운 값
    expect(p.get("loginBrowserRuntime")).toBe("automation");
    expect(url).toMatch(/\/login\.do/);
    expect(humanCheckShown).toBe(true); // 화면이 스스로 사람 확인 칸을 띄운다(우리는 누르지 않는다)
  });
  it("NO_LOGIN_CNT — 남은 횟수 3 · 멈춤 판정", async () => {
    const { result } = await run("NO_LOGIN_CNT");
    expect(result).toMatchObject({ ok: false, code: "NO_LOGIN_CNT", remaining: 3, blockAuto: true });
    expect(server.posts.length).toBe(1);
  });
  it("OK — locationUrl(main.do) 도착까지 확인", async () => {
    const { result, url } = await run("OK");
    expect(result).toMatchObject({ ok: true, code: "OK" });
    expect(new URL(url).pathname).toBe("/main.do");
    expect(server.posts.length).toBe(1);
  });
  it("NO_REJECT — 화면이 재인증으로 옮겨 가도(본문을 못 읽어도) 재인증으로 판정 · 멈춤", async () => {
    const { result, url } = await run("NO_REJECT");
    expect(result).toMatchObject({ ok: false, code: "NO_REJECT", blockAuto: true });
    expect(url).toMatch(/\/loginReCert\.do/);
  });
  it("#membId/#password가 없는 예전 화면만 범용 셀렉터 · 주소로 판정", async () => {
    const ctx = await guarded.newContext();
    const page = await ctx.newPage();
    try {
      const result: Result = await G.submitLogin(page, { id: "fixture-id", pw: "fixture-pw", base: `${server.base}/legacy`, responseTimeoutMs: 5000 });
      expect(server.legacyPosts).toBe(1);
      expect(result).toMatchObject({ ok: true, code: "OK" });
      expect(server.posts.length).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});

describe.skipIf(!browser)("openMakeeduContext — 세션 재사용 → 멈춤 표시 → ID/PW 한 번", () => {
  let dir = "";
  let sessionFile = "";
  beforeEach(() => {
    dir = tmp();
    sessionFile = path.join(dir, "state", "makeedu", "session.json");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    logs.length = 0;
  });
  const logs: string[] = [];
  const open = (env: Record<string, string>) => G.openMakeeduContext(guarded, { sessionFile, env, base: server.base, log: (m: string) => logs.push(m) });
  const lifetimeLines = () => logs.filter((l) => l.startsWith("makeedu 세션 수명"));

  it("① 살아 있는 세션 — 로그인 0회 · 세션 파일을 원자적으로 다시 저장", async () => {
    fs.writeFileSync(sessionFile, JSON.stringify(aliveStorage()));
    const before = fs.statSync(sessionFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    const { ctx, page, via } = await open(CREDS);
    expect(via).toBe("session");
    expect(new URL(page.url()).pathname).toBe("/main.do");
    await ctx.close();
    expect(server.posts.length).toBe(0);
    expect(fs.statSync(sessionFile).mtimeMs).toBeGreaterThan(before);
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).cookies.some((c: { value: string }) => c.value === "good")).toBe(true);
    expect(G.readMeta(sessionFile)).toBeNull(); // 재사용은 '새 로그인'이 아니다
    expect(lifetimeLines()).toEqual([]); // 살아 있으면 수명 줄 없음
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("② 세션이 죽고 사람 확인 요구 → 멈춤 표시 · 다음 실행은 같은 자격으로 로그인하지 않는다 · 자격이 바뀌면 한 번 다시", async () => {
    fs.writeFileSync(sessionFile, JSON.stringify(deadStorage()));
    server.mode = "CAPTCHA_REQUIRED";
    const first = await open(CREDS).catch((e: Error) => e);
    expect(first).toBeInstanceOf(G.MakeeduLoginError);
    expect(first).toMatchObject({ code: "CAPTCHA_REQUIRED", blocked: false, ok: false });
    expect(server.posts.length).toBe(1);
    const block = G.readBlock(sessionFile);
    expect(block).toMatchObject({ code: "CAPTCHA_REQUIRED" });
    expect(G.blockApplies(block, CREDS.MAKEEDU_ID, CREDS.MAKEEDU_PW)).toBe(true);
    expect(fs.readFileSync(G.blockFileOf(sessionFile), "utf8")).not.toContain("fixture-pw");
    // 세션 수명 — 끊긴 걸 처음 안 실행에서 한 줄(세션 저장 후 몇 시간) · 쿠키 값·자격 없음
    expect(lifetimeLines().length).toBe(1);
    expect(lifetimeLines()[0]).toMatch(/세션 저장 후 \d+분/);
    expect(lifetimeLines()[0]).not.toMatch(/expired|fixture-id|fixture-pw/);

    G._resetAttemptForTest(); // 다음 실행(새 프로세스)
    const second = await open(CREDS).catch((e: Error) => e);
    expect(second).toMatchObject({ code: "CAPTCHA_REQUIRED", blocked: true });
    expect((second as Error).message).toMatch(/^makeedu 자동 로그인 멈춤 \[CAPTCHA_REQUIRED\]/);
    expect(server.posts.length).toBe(1); // 로그인 시도 없음
    expect(lifetimeLines().length).toBe(1); // 같은 죽은 세션 파일 — 다시 적지 않는다

    G._resetAttemptForTest();
    server.mode = "OK";
    const changed = await open({ MAKEEDU_ID: "fixture-id", MAKEEDU_PW: "fixture-pw-new" });
    expect(changed.via).toBe("login");
    // 자동화 표시는 화면 스크립트가 채운 그대로 — 누가 webdriver를 숨기면 여기서 깨진다(리뷰 M9)
    expect(server.posts[1].get("loginBrowserRuntime")).toBe("automation");
    await changed.ctx.close();
    expect(server.posts.length).toBe(2);
    expect(G.readBlock(sessionFile)).toBeNull(); // 성공하면 지운다
    expect(G.readMeta(sessionFile)).toMatchObject({ method: "idpw" });
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).cookies.some((c: { value: string }) => c.value === "good")).toBe(true);

    G._resetAttemptForTest();
    const reuse = await open({ MAKEEDU_ID: "fixture-id", MAKEEDU_PW: "fixture-pw-new" });
    expect(reuse.via).toBe("session"); // sync-all 뒤 단계 — 앞 단계가 저장한 세션을 그대로 쓴다
    await reuse.ctx.close();
    expect(server.posts.length).toBe(2);

    // 새로 저장된 세션이 나중에 끊기면(파일 판이 다르다) 다시 한 줄 — 로그인 후 시간도 함께
    fs.writeFileSync(sessionFile, JSON.stringify(deadStorage()));
    G._resetAttemptForTest();
    server.mode = "CAPTCHA_REQUIRED";
    await open({ MAKEEDU_ID: "fixture-id", MAKEEDU_PW: "fixture-pw-new" }).catch(() => {});
    expect(lifetimeLines().length).toBe(2);
    expect(lifetimeLines()[1]).toMatch(/로그인 후 \d+분\(ID\/PW 로그인\)/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("비밀번호 틀림(NO_LOGIN_CNT) — 남은 횟수를 표시에 남기고 다음 실행은 시도하지 않는다", async () => {
    server.mode = "NO_LOGIN_CNT";
    const first = await open(CREDS).catch((e: Error) => e);
    expect(first).toMatchObject({ code: "NO_LOGIN_CNT", remaining: 3 });
    expect((first as Error).message).toContain("남은 시도 3회");
    G._resetAttemptForTest();
    const second = await open(CREDS).catch((e: Error) => e);
    expect(second).toMatchObject({ code: "NO_LOGIN_CNT", remaining: 3, blocked: true });
    expect(server.posts.length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("한 실행에서 두 번째 ID/PW 로그인은 하지 않는다", async () => {
    server.mode = "NO_LOGIN_CNT";
    await open(CREDS).catch(() => {});
    G.clearBlock(sessionFile); // 표시가 없어도
    const again = await open(CREDS).catch((e: Error) => e);
    expect(again).toMatchObject({ code: "ALREADY_ATTEMPTED", ok: null });
    expect(server.posts.length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("세션도 자격도 없으면 로그인하지 않고 NO_CREDENTIALS", async () => {
    const e = await open({}).catch((x: Error) => x);
    expect(e).toMatchObject({ code: "NO_CREDENTIALS", ok: false });
    expect(server.requests.some((r) => r.startsWith("POST"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("옛 MAKEEDU_STORAGE_STATE(env JSON)도 받는다 — 살아 있으면 세션 파일로 옮겨 저장", async () => {
    const { ctx, via } = await open({ MAKEEDU_STORAGE_STATE: JSON.stringify(aliveStorage()) });
    expect(via).toBe("session");
    await ctx.close();
    expect(fs.existsSync(sessionFile)).toBe(true);
    expect(server.posts.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("main.do 접속 실패(SESSION_CHECK_FAILED) — 판정 불가 · ID/PW로 넘어가지 않는다 · 멈춤 표시 없음", async () => {
    fs.writeFileSync(sessionFile, JSON.stringify(aliveStorage()));
    // 아무도 듣지 않는 포트 — main.do 열기부터 실패
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", () => r()));
    const deadBase = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((r) => closed.close(() => r()));
    let contexts = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counting = { newContext: async (o?: object) => (contexts++, guarded.newContext(o)) } as any;
    const e = await G.openMakeeduContext(counting, { sessionFile, env: CREDS, base: deadBase, log: () => {} }).catch((x: Error) => x);
    expect(e).toBeInstanceOf(G.MakeeduLoginError);
    expect(e).toMatchObject({ code: "SESSION_CHECK_FAILED", ok: null });
    expect((e as Error).message).toContain("판정 불가");
    expect(contexts).toBe(1); // 세션 확인 컨텍스트 하나뿐 — ID/PW용 컨텍스트를 열지 않았다
    expect(G.readBlock(sessionFile)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("세션 파일 읽기 오류(없음이 아닌 실패) — 판정 불가 · ID/PW로 넘어가지 않는다", async () => {
    fs.mkdirSync(sessionFile, { recursive: true }); // 디렉터리라 읽기가 EISDIR로 실패
    const e = await open(CREDS).catch((x: Error) => x);
    expect(e).toMatchObject({ code: "SESSION_READ_FAILED", ok: null });
    expect(server.posts.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("경합 — 자동 시도 중에 사람 로그인이 세션을 저장했으면 멈춤 표시를 남기지 않는다 · 벨도 판정 불가로", async () => {
    server.mode = "CAPTCHA_REQUIRED";
    server.onPost = () => fs.writeFileSync(sessionFile, JSON.stringify(aliveStorage())); // 그 사이 사람 창이 저장
    const e = await open(CREDS).catch((x: Error) => x);
    expect(e).toMatchObject({ code: "CAPTCHA_REQUIRED", blockNote: "human_saved", ok: null });
    expect((e as Error).message).toContain("그 사이 사람 로그인 세션이 저장돼 멈춤 표시는 남기지 않음");
    expect(G.readBlock(sessionFile)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("경합 판정 — 세션 파일 시각이 미래(시계가 뒤로 감)여도 그 사이 아무도 저장하지 않았으면 멈춤 표시를 남기고 다음 실행은 보내지 않는다(재리뷰 경미 1)", async () => {
    fs.writeFileSync(sessionFile, JSON.stringify(deadStorage()));
    const future = new Date(Date.now() + 3_600_000);
    fs.utimesSync(sessionFile, future, future); // 예전 판정(수정 시각 > 시도 시작)이면 '사람이 저장함'으로 잘못 봤다
    server.mode = "NO_LOGIN_CNT";
    const first = await open(CREDS).catch((x: Error) => x);
    expect(first).toMatchObject({ code: "NO_LOGIN_CNT", ok: false, blockNote: null });
    expect((first as Error).message).not.toContain("그 사이 사람 로그인");
    expect(G.readBlock(sessionFile)).toMatchObject({ code: "NO_LOGIN_CNT", remaining: 3 });
    G._resetAttemptForTest();
    const second = await open(CREDS).catch((x: Error) => x);
    expect(second).toMatchObject({ code: "NO_LOGIN_CNT", blocked: true });
    expect(server.posts.length).toBe(1); // 실행마다 ID/PW를 다시 보내지 않는다(잠김 쪽으로 가지 않음)
    // 미래 시각의 세션 파일이어도 그 사이 사람이 저장하면(판이 바뀜) 여전히 경합으로 본다
    G.clearBlock(sessionFile);
    G._resetAttemptForTest();
    server.onPost = () => fs.writeFileSync(sessionFile, JSON.stringify(aliveStorage()));
    const raced = await open(CREDS).catch((x: Error) => x);
    expect(raced).toMatchObject({ code: "NO_LOGIN_CNT", blockNote: "human_saved", ok: null });
    expect(G.readBlock(sessionFile)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("probeStoredSession — main.do가 200 · 로그인 아닌 주소인데 로그인 폼을 돌려주면 dead(로그인 폼 표식 · 리뷰 N11)", async () => {
    fs.writeFileSync(sessionFile, JSON.stringify(aliveStorage()));
    for (const mode of ["loginform", "formonly", "botonly"] as const) {
      server.mainMode = mode;
      const probe = await G.probeStoredSession(guarded, { sessionFile, env: {}, base: server.base, noteDead: false });
      expect(probe.state, mode).toBe("dead");
    }
    expect(G.isLoggedInUrl(`${server.base}/main.do`, server.base)).toBe(true); // 주소만 보면 로그인된 화면 — 표식이 막는다
    server.mainMode = "normal";
    const alive = await G.probeStoredSession(guarded, { sessionFile, env: {}, base: server.base, noteDead: false });
    expect(alive.state).toBe("alive");
    await alive.ctx.close();
    // 정기 실행 경로(openMakeeduContext)도 같은 판정 — 로그인 폼이면 세션 재사용하지 않고 ID/PW 단계로 간다
    server.mainMode = "formonly";
    const e = await open({}).catch((x: Error) => x);
    expect(e).toMatchObject({ code: "NO_CREDENTIALS" });
    expect(logs.some((l) => l.startsWith("저장 세션이 만료됐습니다"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("읽지 못한 멈춤 기록으로 막은 실행 — 오류에 readError(읽기 실패 true · 내용 깨짐 false)를 실어 벨 문구가 갈린다 · 둘 다 ID/PW 0회(fix4)", async () => {
    for (const [kind, make] of [
      ["read", () => fs.mkdirSync(G.blockFileOf(sessionFile))], // 읽기 자체 실패(EISDIR)
      ["broken", () => fs.writeFileSync(G.blockFileOf(sessionFile), "{broken")],
    ] as const) {
      fs.rmSync(G.blockFileOf(sessionFile), { recursive: true, force: true });
      make();
      G._resetAttemptForTest();
      const e = await open(CREDS).catch((x: Error) => x); // 세션 파일 없음 → 멈춤 표시 확인 → 막음
      expect(e, kind).toMatchObject({ code: "BLOCK_UNREADABLE", blocked: true, ok: false, readError: kind === "read" });
      const bell = G.notificationTextFor({ code: e.code, remaining: e.remaining, readError: e.readError, reason: e.message }, "2026-11-06");
      expect(bell.title, kind).toBe(kind === "read" ? "동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다" : "동기화 PC의 makeedu 멈춤 기록을 읽지 못했습니다");
      expect(bell.body.includes("비밀번호"), kind).toBe(kind === "broken");
    }
    expect(server.posts.length).toBe(0);
    // check-session이 오류의 readError를 벨로 넘긴다(값만 · INSERT 문장은 그대로)
    const cs = fs.readFileSync(path.join(HERE, "check-session.mjs"), "utf8");
    expect(cs).toContain("readError: e.readError");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("멈춤 표시 쓰기 실패 — 한 번 더 · 안 되면 예비 파일(효력 유지 · 더 최근 것을 읽음) · 둘 다 안 되면 크게 알리고 오류에 싣는다", async () => {
    server.mode = "NO_LOGIN_CNT";
    // 본 표시 = 다른 자격의 낡은 표시 · 읽기 전용(덮어쓰기 rename이 EPERM으로 실패 — 백신·잠금 흉내). 다른 자격이라 이번 실행은 한 번 시도한다.
    const writeRO = (file: string, at: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) fs.chmodSync(file, 0o666);
      fs.writeFileSync(file, JSON.stringify({ code: "NO_LOGIN_CNT", message: "옛", at, credSalt: "0".repeat(32), credHash: "1".repeat(32) }));
      fs.chmodSync(file, 0o444);
    };
    writeRO(G.blockFileOf(sessionFile), "2026-11-01T00:00:00.000Z");
    const first = await open(CREDS).catch((x: Error) => x);
    expect(first).toMatchObject({ code: "NO_LOGIN_CNT" });
    expect(server.posts.length).toBe(1);
    const alt = G.readBlock(sessionFile);
    expect(alt).toMatchObject({ code: "NO_LOGIN_CNT", fallback: true }); // 본(낡음)보다 최근인 예비 표시를 읽는다
    expect(G.blockApplies(alt, CREDS.MAKEEDU_ID, CREDS.MAKEEDU_PW)).toBe(true); // 예비 표시로도 다음 실행은 막힌다
    G._resetAttemptForTest();
    const second = await open(CREDS).catch((x: Error) => x);
    expect(second).toMatchObject({ blocked: true });
    expect(server.posts.length).toBe(1);
    // 둘 다 못 쓰는 경우 — 예비도 다른 자격의(더 최근) 읽기 전용 표시로
    writeRO(G.blockFallbackOf(sessionFile), "2026-11-02T00:00:00.000Z");
    G._resetAttemptForTest();
    const errors: string[] = [];
    const origError = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      const third = await open(CREDS).catch((x: Error) => x);
      expect(third).toMatchObject({ code: "NO_LOGIN_CNT", blockNote: "write_failed" });
      expect((third as Error).message).toContain("⚠️ 멈춤 표시 저장 실패 — 다음 실행이 같은 자격으로 다시 시도할 수 있음");
    } finally {
      console.error = origError;
    }
    expect(errors.join("\n")).toMatch(/🔴🔴 자동 로그인 멈춤 표시를 남기지 못했습니다/);
    expect(server.posts.length).toBe(2);
    for (const f of [G.blockFileOf(sessionFile), G.blockFallbackOf(sessionFile)]) if (fs.existsSync(f)) fs.chmodSync(f, 0o666);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("confirmLoggedIn — main.do 확인(200 · 로그인 계열 아님 · 로그인 폼 아님)일 때만 true", async () => {
    const ctx = await guarded.newContext();
    try {
      expect(await G.confirmLoggedIn(ctx, server.base)).toBe(false); // 쿠키 없음 → 로그인으로 302
      await ctx.addCookies([{ name: "JSESSIONID", value: "good", domain: "127.0.0.1", path: "/" }]);
      expect(await G.confirmLoggedIn(ctx, server.base)).toBe(true);
      server.mainMode = "error500";
      expect(await G.confirmLoggedIn(ctx, server.base)).toBe(false);
      server.mainMode = "loginform";
      expect(await G.confirmLoggedIn(ctx, server.base)).toBe(false);
    } finally {
      await ctx.close();
    }
  });
});

describe.skipIf(!browser)("runHumanLogin — 미리 채우기만 · 로그인 버튼은 사람(시험이 대신 누름)", () => {
  // 사람 대역: 창이 열리고 미리 채우기가 끝나면 그때까지의 제출 수를 적고, 지정한 행동을 한다.
  // click-recert = 로그인 버튼 → 재인증 화면(loginReCert.do)으로 넘어가면 거기서 '인증 완료'까지 사람이 마친다.
  // goto-error / goto-bounce = 로그인하지 않고 같은 사이트 오류 화면 / 잠깐 들렀다 로그인으로 되튕기는 화면으로 간다(성공으로 보면 안 된다).
  // typePw = 미리 채워지지 않은 비밀번호를 사람이 직접 친다.
  // decoys = 로그인 버튼은 누르지 않고, 제출이 아닌 응답 두 개만 일으킨다 — makeedu 출처의 GET /loginPopProc.do ·
  //          다른 출처(decoyOrigin)로의 토큰 실린 POST /loginPopProc.do(둘 다 사람 확인 요구 JSON을 돌려준다).
  type Act = "click" | "click-recert" | "goto-error" | "goto-bounce" | "close" | "none" | "decoys";
  // ua = 사람 창 컨텍스트의 UA(헤드 있는 창 흉내 — UA 묶기 시험) · injectToken = 캡차 위젯이 채우는 g-recaptcha-response 칸을 흉내(시험 쪽 행동).
  async function human(act: Act, opts: { pw?: string; typePw?: string; timeoutMs?: number; blockWith?: Record<string, unknown>; ua?: string; injectToken?: string; decoyOrigin?: string } = {}) {
    const dir = tmp();
    const sessionFile = path.join(dir, "state", "makeedu", "session.json");
    const seen = { postsBeforeHuman: -1, id: "", pw: "", savedOnRecert: null as boolean | null };
    const logs: string[] = [];
    G.writeBlock(sessionFile, G.classifyLoginResult(opts.blockWith ?? { result: "CAPTCHA_REQUIRED" }), "fixture-id", "fixture-pw");
    const launch = async () => {
      const b = await chromium.launch({ headless: true });
      const orig = b.newContext.bind(b);
      b.newContext = async (o?: object) => {
        const ctx = await guard(await orig(opts.ua ? { ...(o ?? {}), userAgent: opts.ua } : o));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx.on("page", async (page: any) => {
          if (act === "none") return;
          try {
            await page.waitForFunction(() => (document.querySelector("#membId") as HTMLInputElement | null)?.value === "fixture-id", null, { timeout: 10_000 });
            await page.waitForTimeout(300);
            seen.postsBeforeHuman = server.posts.length;
            seen.id = await page.inputValue("#membId");
            seen.pw = await page.inputValue("#password");
            if (opts.typePw) await page.fill("#password", opts.typePw);
            if (opts.injectToken)
              await page.evaluate((tok: string) => {
                const t = document.createElement("textarea");
                t.name = "g-recaptcha-response";
                t.value = tok;
                t.style.display = "none";
                document.querySelector("#form")!.appendChild(t);
              }, opts.injectToken);
            if (act === "click") await page.click(".login_btn");
            else if (act === "decoys")
              await page.evaluate(
                async ({ base, other }: { base: string; other: string }) => {
                  await fetch(`${base}/loginPopProc.do?probe=1`).then((r) => r.text()).catch(() => "");
                  await fetch(`${other}/loginPopProc.do`, {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body: "g-recaptcha-response=DECOY-TOKEN-VALUE&loginBrowserRuntime=browser",
                  })
                    .then((r) => r.text())
                    .catch(() => "");
                },
                { base: server.base, other: opts.decoyOrigin ?? "" },
              );
            else if (act === "goto-error") await page.goto(`${server.base}/error.do`);
            else if (act === "goto-bounce") await page.goto(`${server.base}/bounce.do`);
            else if (act === "click-recert") {
              await page.click(".login_btn");
              await page.waitForURL(/\/loginReCert\.do/, { timeout: 10_000 });
              await page.waitForTimeout(600); // 스크립트가 재인증 화면을 '로그인됨'으로 보지 않는지 — 이 사이에 저장하면 안 된다
              seen.savedOnRecert = fs.existsSync(sessionFile);
              await page.click("#fixture-recert-done");
            } else await page.close();
          } catch {
            /* 창이 먼저 닫힘 */
          }
        });
        return ctx;
      };
      return b;
    };
    // 재사용 확인 = 정기 실행과 같은 headless(기본 UA · 바깥 요청 차단은 컨텍스트가 아니라 브라우저 단위라 여기선 로컬만 연다).
    const launchHeadless = () => chromium.launch({ headless: true });
    const result = await H.runHumanLogin({ launch, launchHeadless, base: server.base, sessionFile, id: "fixture-id", pw: opts.pw, timeoutMs: opts.timeoutMs ?? 15_000, pollMs: 100, log: (m: string) => logs.push(m) });
    return { result, seen, sessionFile, dir, logs };
  }

  it("사람이 로그인하면 세션 저장 · 로그인 시각(human) · 멈춤 표시 지움 — 그 전엔 제출 0회 · 자동화 표시 그대로", async () => {
    server.mode = "OK";
    const { result, seen, sessionFile, dir } = await human("click", { pw: "fixture-pw" });
    expect(result).toEqual({ ok: true, code: "OK", headless: "alive" });
    expect(seen.postsBeforeHuman).toBe(0); // 스크립트는 누르지 않았다
    expect(seen).toMatchObject({ id: "fixture-id", pw: "fixture-pw" });
    expect(server.posts.length).toBe(1);
    expect(server.posts[0].get("loginBrowserRuntime")).toBe("automation"); // 사람 창도 webdriver를 숨기지 않는다(리뷰 M12)
    expect(server.checkHits).toBe(1); // 로그인 확인 GET은 탐색 한 번에 한 번(화면 자체의 main.do 이동은 빼고 센다)
    expect(G.readBlock(sessionFile)).toBeNull();
    expect(G.readMeta(sessionFile)).toMatchObject({ method: "human" });
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).cookies.some((c: { value: string }) => c.value === "good")).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("재인증(NO_REJECT) — 사람이 재인증 화면까지 마치면 세션 저장 · 재인증 화면에서는 저장하지 않음 · 사람 확인 멈춤 지움", async () => {
    server.mode = "NO_REJECT";
    const { result, seen, sessionFile, dir } = await human("click-recert", { pw: "fixture-pw", blockWith: { result: "NO_REJECT" } });
    expect(result).toEqual({ ok: true, code: "OK", headless: "alive" });
    expect(seen.postsBeforeHuman).toBe(0);
    expect(seen.savedOnRecert).toBe(false); // loginReCert.do는 로그인된 화면이 아니다
    expect(server.posts.length).toBe(1);
    expect(G.readBlock(sessionFile)).toBeNull();
    expect(G.readMeta(sessionFile)).toMatchObject({ method: "human" });
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).cookies.some((c: { value: string }) => c.value === "good")).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("OK의 locationUrl이 '/'이고 리다이렉트가 없어도 — 로그인 확인(main.do)으로 성공", async () => {
    server.mode = "OK_ROOT";
    const { result, sessionFile, dir } = await human("click", { pw: "fixture-pw" });
    expect(result).toEqual({ ok: true, code: "OK", headless: "alive" });
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).cookies.some((c: { value: string }) => c.value === "good")).toBe(true);
    expect(server.checkHits).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("같은 사이트 오류 화면으로 가도 로그인이 확인되지 않으면 성공이 아니다 — 저장 없음 · 확인 GET 1번", async () => {
    const { result, sessionFile, dir } = await human("goto-error", { pw: "fixture-pw", timeoutMs: 3000 });
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(G.readBlock(sessionFile)).toMatchObject({ code: "CAPTCHA_REQUIRED" });
    expect(server.checkHits).toBe(1); // 탐색 한 번 → 확인 한 번(5분 내내 두드리지 않는다)
    expect(server.posts.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("잠깐 들렀다 로그인 화면으로 되튕기면 성공이 아니다(리뷰 M14)", async () => {
    const { result, sessionFile, dir } = await human("goto-bounce", { pw: "fixture-pw", timeoutMs: 3000 });
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(server.checkHits).toBeLessThanOrEqual(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("저장 세션에서 makeedu 사이트 것만 남긴다(바깥 쿠키·저장소 제외)", () => {
    const B = "https://school.makeedu.co.kr";
    const state = {
      cookies: [
        { name: "JSESSIONID", value: "a", domain: "school.makeedu.co.kr", path: "/" },
        { name: "p", value: "b", domain: ".makeedu.co.kr", path: "/" },
        { name: "NID", value: "g", domain: ".google.com", path: "/" },
        { name: "_GRECAPTCHA", value: "r", domain: "www.google.com", path: "/recaptcha" },
        { name: "lite", value: "l", domain: "lite.makeedu.co.kr", path: "/" },
      ],
      origins: [{ origin: B, localStorage: [] }, { origin: "https://www.google.com", localStorage: [{ name: "x", value: "y" }] }],
    };
    const out = G.filterStorageForSite(state, B);
    expect(out.cookies.map((c: { name: string }) => c.name)).toEqual(["JSESSIONID", "p"]);
    expect(out.origins.map((o: { origin: string }) => o.origin)).toEqual([B]);
  });

  it("비밀번호 틀림 멈춤 — 저장 비밀번호를 미리 채우지 않는다 · 사람이 직접 쳐서 성공해도 멈춤은 남는다(blockKept) · 그동안 저장 세션은 계속 쓴다(ID/PW 0회)", async () => {
    server.mode = "OK";
    const { result, seen, sessionFile, dir } = await human("click", { pw: "fixture-pw", typePw: "typed-by-human", blockWith: { result: "NO_LOGIN_CNT", result_cnt: 2 } });
    expect(seen.pw).toBe(""); // 틀린 것으로 확인된 저장 비밀번호는 채우지 않았다(아이디만)
    expect(seen.id).toBe("fixture-id");
    expect(server.posts[0].get("password")).toBe("typed-by-human");
    expect(result).toEqual({ ok: true, code: "OK", headless: "alive", blockKept: "NO_LOGIN_CNT" });
    expect(G.readBlock(sessionFile)).toMatchObject({ code: "NO_LOGIN_CNT", remaining: 2 });
    expect(server.posts.length).toBe(1); // 사람이 누른 한 번
    G._resetAttemptForTest();
    const reuse = await G.openMakeeduContext(guarded, { sessionFile, env: CREDS, base: server.base, log: () => {} });
    expect(reuse.via).toBe("session");
    await reuse.ctx.close();
    expect(server.posts.length).toBe(1); // 자동 ID/PW 없음
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("비밀번호를 받지 않으면 비밀번호 칸은 비워 둔다", async () => {
    const { seen, dir } = await human("close");
    expect(seen.id).toBe("fixture-id");
    expect(seen.pw).toBe("");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("창을 닫으면 CLOSED · 멈춤 표시 그대로", async () => {
    const { result, sessionFile, dir } = await human("close", { pw: "fixture-pw" });
    expect(result).toMatchObject({ ok: false, code: "CLOSED" });
    expect(G.readBlock(sessionFile)).toMatchObject({ code: "CAPTCHA_REQUIRED" });
    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(server.posts.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("시간이 넘으면 TIMEOUT · 자동 제출 없음 · 멈춤 표시 그대로", async () => {
    const { result, sessionFile, dir } = await human("none", { pw: "fixture-pw", timeoutMs: 1500 });
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT", last: null });
    expect(server.posts.length).toBe(0);
    expect(G.readBlock(sessionFile)).toMatchObject({ code: "CAPTCHA_REQUIRED" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("사람이 눌렀지만 사람 확인에서 멈춘 채 시간이 넘으면 마지막 makeedu 응답을 함께 돌려준다", async () => {
    server.mode = "CAPTCHA_REQUIRED";
    const { result, dir } = await human("click", { pw: "fixture-pw", timeoutMs: 3000 });
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT", last: { code: "CAPTCHA_REQUIRED", remaining: null, captchaToken: false, runtime: "automation" } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── 리뷰 13: 사람 로그인 직후 headless 재사용 확인 ──
  it("headless 재사용 확인 실패(makeedu가 세션을 만든 브라우저(UA)에 묶음) — HEADLESS_REJECTED · 사람 확인 멈춤은 그대로 · 로그 한 줄", async () => {
    server.mode = "OK";
    server.uaBind = true; // 세션을 만든 UA(사람 창)와 다른 UA(headless)면 main.do가 로그인으로 튕긴다
    const { result, sessionFile, dir, logs } = await human("click", { pw: "fixture-pw", ua: "FixtureHeadedChrome/1.0" });
    expect(result).toMatchObject({ ok: false, code: "HEADLESS_REJECTED", headless: "dead" });
    expect(server.sessionUA).toBe("FixtureHeadedChrome/1.0");
    expect(G.readBlock(sessionFile)).toMatchObject({ code: "CAPTCHA_REQUIRED" }); // 풀지 않았다
    expect(logs.some((l) => l.startsWith("🔴 headless 재사용 확인 실패"))).toBe(true);
    expect(fs.existsSync(G.deadMarkFileOf(sessionFile))).toBe(false); // 확인용 점검은 세션 수명 줄을 쓰지 않는다
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("headless 재사용 확인을 못 함(접속 끊김 — 판정 불가) — 성공으로 두고 '확인 못 함'을 로그에", async () => {
    server.mode = "OK";
    server.dropHeadless = true;
    const { result, sessionFile, dir, logs } = await human("click", { pw: "fixture-pw", ua: "FixtureHeadedChrome/1.0" });
    expect(result).toEqual({ ok: true, code: "OK", headless: "unknown" });
    expect(G.readBlock(sessionFile)).toBeNull();
    expect(logs.some((l) => l.startsWith("headless 재사용 확인 못 함"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("headless 재사용 확인 통과 — 같은 세션 점검 함수(probeStoredSession)로 main.do 한 번 · 로그 한 줄", async () => {
    server.mode = "OK";
    const { result, dir, logs } = await human("click", { pw: "fixture-pw", ua: "FixtureHeadedChrome/1.0" });
    expect(result).toEqual({ ok: true, code: "OK", headless: "alive" });
    expect(logs).toContain("headless 재사용 확인 통과 — 자동 실행이 이 세션을 씁니다.");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── 리뷰 14: 사람 창 제출 진단(관찰만) ──
  it("캡차 토큰이 채워진 제출에도 CAPTCHA_REQUIRED — '풀었는데 거절'(CAPTCHA_REJECTED)로 바로 끝 · 진단 두 가지만 · 본문·토큰·비밀번호는 어디에도 없음", async () => {
    server.mode = "CAPTCHA_REQUIRED";
    const started = Date.now();
    const { result, dir, logs, sessionFile } = await human("click", { pw: "fixture-pw", injectToken: "FIXTURE-TOKEN-SECRET-VALUE", timeoutMs: 15_000 });
    expect(Date.now() - started).toBeLessThan(10_000); // 5분(여기선 15초) 기다리지 않는다
    expect(result).toMatchObject({ ok: false, code: "CAPTCHA_REJECTED", last: { code: "CAPTCHA_REQUIRED", captchaToken: true, runtime: "automation" } });
    expect(server.posts[0].get("g-recaptcha-response")).toBe("FIXTURE-TOKEN-SECRET-VALUE"); // 제출에는 실렸다(화면 동작)
    expect(logs).toContain("제출 진단 — 캡차 토큰 있음 · loginBrowserRuntime=automation · makeedu 응답 CAPTCHA_REQUIRED");
    const everything = JSON.stringify({ result, logs }) + (fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "");
    for (const secret of ["FIXTURE-TOKEN-SECRET-VALUE", "fixture-pw", "membId=", "password=", "g-recaptcha-response="]) expect(everything, secret).not.toContain(secret);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("성공 때 도착 화면은 경로만(;jsessionid·쿼리 제외) 로그에 · 진단 줄도 값 없이", async () => {
    server.mode = "OK_JSESSION";
    const { result, dir, logs } = await human("click", { pw: "fixture-pw" });
    expect(result).toMatchObject({ ok: true, code: "OK" });
    expect(logs).toContain("makeedu 로그인 확인 — 도착 화면 /main.do · 세션을 저장했습니다.");
    const all = logs.join("\n");
    expect(all).not.toContain("SECRETSESSIONVALUE");
    expect(all).not.toContain("FIXTUREQUERY");
    expect(all).not.toContain("fixture-pw");
    expect(all).toMatch(/제출 진단 — 캡차 토큰 없음 · loginBrowserRuntime=automation/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("제출 진단은 makeedu 출처의 POST만 센다 — 다른 출처의 토큰 실린 POST · 같은 주소의 GET 응답은 마지막 응답·'풀었는데 거절'을 세우지 않는다(재리뷰 경미 5)", async () => {
    const otherPosts: string[] = [];
    const other = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.method === "POST") otherPosts.push(req.url || "");
        res.writeHead(200, { "content-type": "application/json;charset=UTF-8", "access-control-allow-origin": "*" });
        res.end(JSON.stringify({ result: "CAPTCHA_REQUIRED" }));
      });
    });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", () => r()));
    const otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    try {
      server.mode = "CAPTCHA_REQUIRED";
      const { result, dir, logs } = await human("decoys", { pw: "fixture-pw", decoyOrigin: otherOrigin, timeoutMs: 3000 });
      // 미끼 두 응답은 실제로 오갔다
      expect(server.requests).toContain("GET /loginPopProc.do?probe=1");
      expect(otherPosts).toEqual(["/loginPopProc.do"]);
      expect(server.posts.length).toBe(0); // makeedu 출처 제출은 없었다
      // 그래도 사람 제출로 세지 않는다 — CAPTCHA_REJECTED로 끝나지 않고 시간 초과 · 마지막 응답 없음 · 진단 줄 없음
      expect(result).toEqual({ ok: false, code: "TIMEOUT", last: null });
      expect(logs.some((l) => l.startsWith("제출 진단"))).toBe(false);
      expect(JSON.stringify(logs)).not.toContain("DECOY-TOKEN-VALUE");
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      await new Promise<void>((r) => other.close(() => r()));
    }
  });

  it("submissionDiag·safePathname·isLoginSubmit(순수) — 두 가지만 · 값은 돌려주지 않는다 · makeedu 출처 POST만 제출", () => {
    const B = "https://school.makeedu.co.kr";
    expect(H.isLoginSubmit(`${B}/loginPopProc.do;jsessionid=X`, "POST", B)).toBe(true);
    expect(H.isLoginSubmit(`${B}/loginPopProc.do`, "post", B)).toBe(true);
    expect(H.isLoginSubmit(`${B}/loginPopProc.do`, "GET", B)).toBe(false);
    expect(H.isLoginSubmit("https://evil.example/loginPopProc.do", "POST", B)).toBe(false);
    expect(H.isLoginSubmit("https://www.google.com/recaptcha/loginPopProc.do", "POST", B)).toBe(false);
    expect(H.isLoginSubmit(`${B}/x/loginPopProc.do`, "POST", B)).toBe(true); // 같은 출처면 경로 위치는 묶지 않는다(submitLogin과 같은 범위)
    expect(H.isLoginSubmit(`${B}/loginPopProc.doX`, "POST", B)).toBe(false);
    expect(H.isLoginSubmit("not a url", "POST", B)).toBe(false);
    expect(H.submissionDiag("membId=a&password=p&loginBrowserRuntime=automation&g-recaptcha-response=TOKEN")).toEqual({ captchaToken: true, runtime: "automation" });
    expect(H.submissionDiag("membId=a&password=p&loginBrowserRuntime=browser&g-recaptcha-response=")).toEqual({ captchaToken: false, runtime: "browser" });
    expect(H.submissionDiag("membId=a")).toEqual({ captchaToken: false, runtime: "none" });
    expect(H.submissionDiag("loginBrowserRuntime=<script>")).toEqual({ captchaToken: false, runtime: "other" });
    expect(H.submissionDiag(null)).toEqual({ captchaToken: false, runtime: "none" });
    expect(JSON.stringify(H.submissionDiag("password=SECRETPW&g-recaptcha-response=SECRETTOKEN"))).not.toMatch(/SECRET/);
    expect(H.safePathname("https://school.makeedu.co.kr/main.do;jsessionid=ABC?x=1#y")).toBe("/main.do");
    expect(H.safePathname("https://school.makeedu.co.kr/")).toBe("/");
    expect(H.safePathname("not a url")).toBe("(알 수 없음)");
  });

  it("브라우저를 못 띄우면 LAUNCH_FAILED", async () => {
    const result = await H.runHumanLogin({ launch: async () => { throw new Error("no browser"); }, base: server.base, sessionFile: path.join(os.tmpdir(), "never.json") });
    expect(result).toEqual({ ok: false, code: "LAUNCH_FAILED" });
  });
});
