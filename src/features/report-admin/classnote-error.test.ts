import { describe, it, expect } from "vitest";
import { humanizeClassnoteError } from "./classnote-error";

describe("humanizeClassnoteError", () => {
  it("빈 값 → null", () => {
    expect(humanizeClassnoteError(null)).toBeNull();
    expect(humanizeClassnoteError("  ")).toBeNull();
  });

  it("주소/네트워크 계열 — 실측 원문(page.goto ERR_NAME_NOT_RESOLVED)", () => {
    const raw =
      'page.goto: net::ERR_NAME_NOT_RESOLVED at https://eywa-alpha-vercel.app/r/61d1\nCall log:\n  - navigating to "…"';
    expect(humanizeClassnoteError(raw)).toContain("발송 PC가 보고서 주소에 접속하지 못함");
  });

  it("타임아웃 계열", () => {
    expect(humanizeClassnoteError("page.goto: Timeout 120000ms exceeded")).toContain("시간 초과");
  });

  it("로그인 계열", () => {
    expect(humanizeClassnoteError("login failed: invalid credential")).toContain("로그인 실패");
  });

  it("미지의 원문 → 일반 안내(원문 노출 없음)", () => {
    const out = humanizeClassnoteError("some totally unknown internal stack trace");
    expect(out).toContain("발송 실패");
    expect(out).not.toContain("stack");
  });
});
