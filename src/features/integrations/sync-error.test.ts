import { describe, it, expect } from "vitest";
import { humanizeMakeeduSyncError } from "./sync-error";

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
