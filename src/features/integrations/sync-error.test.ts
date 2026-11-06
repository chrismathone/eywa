import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { humanizeMakeeduSyncError } from "./sync-error";

// 워커가 실제로 보내는 문장(scripts/_makeedu/login-guard.cjs)으로 시험한다 — 문구가 갈라지면 여기서 깨진다.
const G = createRequire(import.meta.url)("../../../scripts/_makeedu/login-guard.cjs") as {
  classifyLoginResult: (json: unknown) => { ok: boolean | null; code: string; message: string; blockAuto: boolean; remaining: number | null };
  loginErrorMessage: (r: { ok?: boolean | null; code: string; message: string; blockAuto?: boolean }, o?: { blocked?: boolean; at?: string | null; blockNote?: string | null }) => string;
  blockFileOf: (sessionFile: string) => string;
  readBlock: (sessionFile: string) => { code: string; message: string; at: string | null } | null;
};
// sync-all.cjs는 자식의 `ERR <문구>`를 300자로 잘라 "<파일> exited 1 — <문구>"로 싣는다.
const viaSyncAll = (msg: string) => `scrape.cjs exited 1 — ${msg.slice(0, 300)}`;
const fresh = (json: unknown) => viaSyncAll(G.loginErrorMessage(G.classifyLoginResult(json)));
const blocked = (json: unknown) => viaSyncAll(G.loginErrorMessage(G.classifyLoginResult(json), { blocked: true, at: "2026-11-05T21:00:03.000Z" }));

describe("humanizeMakeeduSyncError — 2026-11-06 사람 확인 대응(재인증·로그인 실패보다 먼저)", () => {
  const HUMAN = "makeedu가 자동 로그인에 사람 확인을 요구합니다 — 동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'이 필요합니다";
  it("CAPTCHA_REQUIRED — 처음 막힌 실행", () => {
    expect(humanizeMakeeduSyncError(fresh({ result: "CAPTCHA_REQUIRED" }))).toBe(HUMAN);
  });
  it("CAPTCHA_REQUIRED — 멈춤 표시로 로그인하지 않은 실행", () => {
    const raw = blocked({ result: "CAPTCHA_REQUIRED" });
    expect(raw).toContain("자동 로그인 멈춤");
    expect(humanizeMakeeduSyncError(raw)).toBe(HUMAN);
  });
  it("NO_REJECT(재인증) — 사람 확인과 같은 갈래(처음 막힘 · 멈춤 표시 둘 다)", () => {
    expect(humanizeMakeeduSyncError(fresh({ result: "NO_REJECT" }))).toBe(HUMAN);
    expect(humanizeMakeeduSyncError(blocked({ result: "NO_REJECT" }))).toBe(HUMAN);
  });
  it("비밀번호 틀림(NO_LOGIN_CNT) — makeedu 원문 '로그인 정보가 올바르지 않습니다 · 남은 시도 N회' · 비밀번호 확인해 다시 저장", () => {
    for (const raw of [fresh({ result: "NO_LOGIN_CNT", result_cnt: 3 }), blocked({ result: "NO_LOGIN_CNT", result_cnt: 3 })]) {
      expect(humanizeMakeeduSyncError(raw)).toBe(
        "makeedu 로그인 정보가 올바르지 않습니다 · 남은 시도 3회 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 비밀번호를 확인해 다시 저장해야 자동 로그인이 풀립니다(더 틀리면 계정이 잠길 수 있습니다)",
      );
    }
  });
  it("비밀번호 틀림 — 남은 횟수를 모르면 숫자 없이", () => {
    const out = humanizeMakeeduSyncError(fresh({ result: "NO_LOGIN_CNT" }))!;
    expect(out).toContain("로그인 정보가 올바르지 않습니다 —");
    expect(out).not.toMatch(/남은 시도 \d/);
  });
  it("NO_CHK — 인증정보가 올바르지 않음 · 비밀번호 계열 안내", () => {
    expect(humanizeMakeeduSyncError(blocked({ result: "NO_CHK" }))).toBe(
      "makeedu 인증정보가 올바르지 않습니다 — 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 비밀번호를 확인해 다시 저장해야 자동 로그인이 풀립니다",
    );
  });
  it("계정 계열(NOK·NO_PASS·NO_PTYPE·NOK_LIMIT) — 원인 + makeedu에서 해결 → 비밀번호 한 번 더 저장(같은 값이어도)", () => {
    const THEN = "makeedu에서 해결한 뒤 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다";
    const want: Record<string, string> = {
      NOK: "makeedu 계정이 미인증 상태입니다",
      NO_PASS: "makeedu 호출정보가 올바르지 않습니다",
      NO_PTYPE: "makeedu가 이 계정을 무료형·실속형(라이트) 사용자로 안내합니다",
      NOK_LIMIT: "makeedu가 사용 기한·결제 화면으로 안내합니다",
    };
    for (const [result, what] of Object.entries(want)) {
      expect(humanizeMakeeduSyncError(fresh({ result })), result).toBe(`${what} — ${THEN}`);
      expect(humanizeMakeeduSyncError(blocked({ result })), result).toBe(`${what} — ${THEN}`);
    }
    expect(humanizeMakeeduSyncError(blocked({ result: "SOMETHING_NEW" }))).toBe(`makeedu가 알 수 없는 응답(SOMETHING_NEW)으로 로그인을 거절했습니다 — ${THEN}`);
  });
  it("네트워크 오류(net::ERR_ … at …/login.do)를 '아이디/비밀번호 확인'으로 오진하지 않는다 — 판정 불가", () => {
    const pageErr = viaSyncAll(
      G.loginErrorMessage({ ok: null, code: "LOGIN_PAGE_ERROR", message: "makeedu 로그인 화면 처리 실패(네트워크·사이트 문제일 수 있음 — 판정 불가): page.goto: net::ERR_CONNECTION_RESET at https://school.makeedu.co.kr/login.do" }),
    );
    for (const raw of [pageErr, "scrape.cjs exited 1 — page.goto: net::ERR_NAME_NOT_RESOLVED at https://school.makeedu.co.kr/login.do"]) {
      const out = humanizeMakeeduSyncError(raw)!;
      expect(out).toMatch(/^makeedu 로그인 상태를 확인하지 못했습니다\(네트워크·사이트 문제 등 — 판정 불가\)/);
      expect(out).not.toContain("아이디/비밀번호");
    }
    // 세션 파일 잠김(EBUSY) — 판정 불가
    expect(humanizeMakeeduSyncError(viaSyncAll(G.loginErrorMessage({ ok: null, code: "SESSION_READ_FAILED", message: "저장 세션 파일을 읽지 못했습니다(EBUSY — 판정 불가 · ID/PW로 넘어가지 않음)" })))).toMatch(/판정 불가/);
  });
  it("세션도 자격도 없음 — 기존 '로그인 정보 없음' 그대로", () => {
    const raw = viaSyncAll(G.loginErrorMessage({ code: "NO_CREDENTIALS", message: "저장된 세션이 없거나 만료됐고 MAKEEDU_ID / MAKEEDU_PW도 없습니다" }));
    expect(humanizeMakeeduSyncError(raw)).toContain("로그인 정보(ID/PW)가 없습니다");
  });
  it("멈춤 표시 저장 실패(write_failed) — 코드별 사유보다 앞에서 '⚠️ 멈춤 표시 저장 실패 … (잠김 위험)'을 앞머리로 · 원래 사유는 뒤에 그대로(재리뷰 경미 3)", () => {
    const HEAD = "⚠️ 멈춤 표시 저장 실패 — 다음 실행이 같은 자격으로 다시 시도할 수 있음(잠김 위험) · ";
    for (const json of [{ result: "NO_LOGIN_CNT", result_cnt: 3 }, { result: "NO_CHK" }, { result: "NOK" }, { result: "CAPTCHA_REQUIRED" }, { result: "SOMETHING_NEW" }]) {
      const plain = humanizeMakeeduSyncError(fresh(json))!;
      const raw = viaSyncAll(G.loginErrorMessage(G.classifyLoginResult(json), { blockNote: "write_failed" }));
      expect(raw, json.result).toContain("멈춤 표시 저장 실패");
      expect(humanizeMakeeduSyncError(raw), json.result).toBe(`${HEAD}${plain}`);
    }
    // 저장 실패가 아니면 앞머리 없음
    expect(humanizeMakeeduSyncError(fresh({ result: "NO_LOGIN_CNT", result_cnt: 3 }))).not.toContain("저장 실패");
  });
  it("동기화 PC의 멈춤 기록을 읽지 못함(BLOCK_UNREADABLE) — 'makeedu가 알 수 없는 응답으로 거절'이 아니다 · 진짜 모르는 makeedu 응답과 구분(재리뷰 경미 4)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-error-unreadable-"));
    try {
      const sessionFile = path.join(dir, "session.json");
      fs.writeFileSync(G.blockFileOf(sessionFile), "{broken");
      const b = G.readBlock(sessionFile)!;
      const raw = viaSyncAll(G.loginErrorMessage({ ok: false, code: b.code, message: b.message, blockAuto: true }, { blocked: true, at: b.at }));
      expect(humanizeMakeeduSyncError(raw)).toBe(
        "동기화 PC의 makeedu 자동 로그인 멈춤 기록을 읽지 못했습니다 — 안전을 위해 자동 로그인을 멈췄습니다 · 동기화 PC의 AYWA 연동 앱 '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다",
      );
      // 파일 읽기 자체 실패(EISDIR — 잠김·권한 흉내 · fix4) — 같은 코드지만 비밀번호 저장으로 안 풀리므로 그 안내 없이
      fs.rmSync(G.blockFileOf(sessionFile));
      fs.mkdirSync(G.blockFileOf(sessionFile));
      const r = G.readBlock(sessionFile)!;
      const rawRead = viaSyncAll(G.loginErrorMessage({ ok: false, code: r.code, message: r.message, blockAuto: true }, { blocked: true, at: r.at }));
      expect(rawRead).toContain("[BLOCK_UNREADABLE]");
      const outRead = humanizeMakeeduSyncError(rawRead)!;
      expect(outRead).toBe(
        "동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등) — 안전을 위해 자동 로그인을 멈춰 두었습니다 · 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다)",
      );
      expect(outRead).not.toMatch(/비밀번호|연동 계정/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // makeedu가 정말 모르는 응답을 보낸 경우는 그대로
    expect(humanizeMakeeduSyncError(blocked({ result: "<weird>" }))).toMatch(/^makeedu가 알 수 없는 응답\(UNKNOWN\)으로 로그인을 거절했습니다/);
  });
  it("판정 불가(응답 없음)는 사람 확인·비밀번호로 단정하지 않는다", () => {
    const out = humanizeMakeeduSyncError(fresh(null))!;
    expect(out).not.toContain("사람 확인");
    expect(out).not.toContain("비밀번호");
  });
});

describe("humanizeMakeeduSyncError", () => {
  it("빈 값 → null", () => {
    expect(humanizeMakeeduSyncError(null)).toBeNull();
    expect(humanizeMakeeduSyncError("  ")).toBeNull();
  });

  it("크리덴셜 누락 — 실측 원문(MAKEEDU_ID/PW 없음)", () => {
    const raw = "scrape.cjs exited 1 — MAKEEDU_ID / MAKEEDU_PW 가 .env.local 에 없습니다.";
    expect(humanizeMakeeduSyncError(raw)).toContain("로그인 정보(ID/PW)가 없습니다");
  });

  it("재인증(캡차) 벽", () => {
    const raw = "scrape.cjs exited 1 — makeedu 재인증 벽(loginReCert.do) — CAPTCHA+휴대폰 인증 필요.";
    expect(humanizeMakeeduSyncError(raw)).toContain("재인증");
  });

  it("세션 만료", () => {
    const raw = "scrape.cjs exited 1 — 저장된 세션이 무효/만료됐거나 IP에서 거부됨.";
    expect(humanizeMakeeduSyncError(raw)).toContain("세션 만료");
  });

  it("로그인 실패 — exited와 원인이 함께 있어도 원인 우선", () => {
    const raw = "scrape.cjs exited 1 — 로그인 실패(여전히 login.do) — ID/PW 또는 폼 셀렉터 확인.";
    expect(humanizeMakeeduSyncError(raw)).toContain("로그인 실패");
  });

  it("0행 가드 — '세션 만료 의심'을 단정으로 승격하지 않는다(2026-08-03 partial 실행 재현)", () => {
    const raw =
      "invoices: import-invoices.cjs exited 1 — ✖ 스크랩 0행 — makeedu 상세수납 목록을 못 읽었다" +
      "(세션 만료·URL/셀렉터 변경 의심). 이번 실행은 반영하지 않음.";
    const out = humanizeMakeeduSyncError(raw);
    expect(out).toContain("반영하지 않았습니다");
    expect(out).toContain("의심"); // 추측은 추측으로
    expect(out).not.toBe("makeedu 세션 만료 — 동기화 PC에서 다시 로그인이 필요합니다");
    expect(out).not.toContain("exited");
  });

  it("원인 없는 구(舊) 래퍼 문구(scrape.cjs exited 1) → 일반 안내", () => {
    const out = humanizeMakeeduSyncError("scrape.cjs exited 1");
    expect(out).toContain("동기화 실행 실패");
    expect(out).not.toContain("exited");
  });

  it("미지의 원문 → 일반 안내(원문 노출 없음)", () => {
    const out = humanizeMakeeduSyncError("some totally unknown internal error blob");
    expect(out).toContain("동기화 실패");
    expect(out).not.toContain("blob");
  });
});
