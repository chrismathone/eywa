import { describe, it, expect } from "vitest";
import { sanitizeErrorText } from "./sanitize-error";

const ESC = String.fromCharCode(27); // ANSI 시퀀스 시작(터미널 색코드)

describe("sanitizeErrorText", () => {
  it("null·빈 문자열 → 빈 문자열", () => {
    expect(sanitizeErrorText(null)).toBe("");
    expect(sanitizeErrorText(undefined)).toBe("");
    expect(sanitizeErrorText("   ")).toBe("");
  });

  it("ANSI 색코드(ESC[2m … ESC[22m)를 제거한다", () => {
    const raw = `${ESC}[2m  - navigating to url${ESC}[22m`;
    const out = sanitizeErrorText(raw);
    expect(out).toBe("- navigating to url");
    expect(out).not.toContain(ESC);
    expect(out).not.toContain("[2m");
    expect(out).not.toContain("[22m");
  });

  it("Playwright 타임아웃 원문(ANSI+개행)을 한 줄 가독 텍스트로", () => {
    const raw = `page.goto: Timeout 30000ms exceeded.\nCall log:\n${ESC}[2m  - navigating to "https://x/r/abc", waiting until "networkidle"${ESC}[22m\n`;
    const out = sanitizeErrorText(raw);
    expect(out).toContain("Timeout 30000ms exceeded");
    expect(out).toContain("navigating to");
    expect(out).not.toContain(ESC);
    expect(out).not.toContain("[2m");
    expect(out).not.toContain("  "); // 공백 정규화(연속 공백 없음)
    expect(out).not.toContain("\n"); // 개행 제거
  });

  it("일반 텍스트(대괄호 포함)는 보존한다", () => {
    expect(sanitizeErrorText("ClassNote 보드 [수학]학원이 없음")).toBe("ClassNote 보드 [수학]학원이 없음");
  });
});
