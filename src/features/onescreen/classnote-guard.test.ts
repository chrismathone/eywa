import { describe, expect, it } from "vitest";
import { classnoteMinDate, isClassnoteAllowed, isClassnoteSubjectEnabled } from "./classnote-guard";

describe("classnoteMinDate", () => {
  it("전 달 1일", () => {
    expect(classnoteMinDate("2026-07-07")).toBe("2026-06-01");
    expect(classnoteMinDate("2026-07-01")).toBe("2026-06-01");
  });
  it("1월 → 전년 12월", () => {
    expect(classnoteMinDate("2026-01-10")).toBe("2025-12-01");
  });
});

describe("isClassnoteAllowed (KST 문자열 비교)", () => {
  const today = "2026-07-07"; // minDate 2026-06-01
  it("전 달 1일 이후는 허용", () => {
    expect(isClassnoteAllowed("2026-06-01", today)).toBe(true);
    expect(isClassnoteAllowed("2026-07-05", today)).toBe(true);
    expect(isClassnoteAllowed("2026-07-07", today)).toBe(true);
  });
  it("전 달 1일 이전은 차단(사고 방지)", () => {
    expect(isClassnoteAllowed("2026-05-31", today)).toBe(false);
    expect(isClassnoteAllowed("2026-01-15", today)).toBe(false);
  });
  it("빈 값은 차단", () => {
    expect(isClassnoteAllowed("", today)).toBe(false);
  });
  it("1월 경계", () => {
    expect(isClassnoteAllowed("2025-12-01", "2026-01-10")).toBe(true);
    expect(isClassnoteAllowed("2025-11-30", "2026-01-10")).toBe(false);
  });
});

describe("isClassnoteSubjectEnabled (과목별 발송 게이트)", () => {
  it("허용 목록에 든 과목만 발송", () => {
    expect(isClassnoteSubjectEnabled("math", ["math"])).toBe(true);
    expect(isClassnoteSubjectEnabled("english", ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled("math", ["math", "english"])).toBe(true);
  });
  it("빈 목록 = 어떤 과목도 발송 안 함(명시 opt-in)", () => {
    expect(isClassnoteSubjectEnabled("math", [])).toBe(false);
    expect(isClassnoteSubjectEnabled("english", [])).toBe(false);
  });
  it("레거시 subject=null/빈값은 math로 정규화", () => {
    expect(isClassnoteSubjectEnabled(null, ["math"])).toBe(true);
    expect(isClassnoteSubjectEnabled(undefined, ["math"])).toBe(true);
    expect(isClassnoteSubjectEnabled("", ["math"])).toBe(true);
    expect(isClassnoteSubjectEnabled(null, ["english"])).toBe(false);
  });
});
