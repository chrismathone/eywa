import { describe, expect, it } from "vitest";
import { isValidYm, isValidYmd } from "./date-kst";

describe("isValidYmd — URL 날짜 필터(received=·first=) 검증", () => {
  it("달력에 있는 날만 통과", () => {
    expect(isValidYmd("2026-09-11")).toBe(true);
    expect(isValidYmd("2024-02-29")).toBe(true); // 윤년
    expect(isValidYmd("2026-12-31")).toBe(true);
  });

  it("🔴 모양은 맞아도 없는 날은 거짓 — 2월 30일·13월·0일·평년 2월 29일", () => {
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026-00-10")).toBe(false);
    expect(isValidYmd("2026-09-00")).toBe(false);
    expect(isValidYmd("2025-02-29")).toBe(false);
    expect(isValidYmd("0099-01-01")).toBe(false); // Date.UTC가 1999년으로 옮기는 값
  });

  it("모양이 틀리거나 문자열이 아니면 거짓", () => {
    for (const raw of ["2026-9-11", "20260911", "2026-09-11T00:00", "abc", "", " 2026-09-11", undefined, null, 20260911]) {
      expect(isValidYmd(raw)).toBe(false);
    }
  });
});

describe("isValidYm — URL 달 필터(month=) 검증", () => {
  it("01~12월만 통과", () => {
    expect(isValidYm("2026-09")).toBe(true);
    expect(isValidYm("2026-12")).toBe(true);
    expect(isValidYm("2026-13")).toBe(false);
    expect(isValidYm("2026-00")).toBe(false);
    expect(isValidYm("2026-9")).toBe(false);
    expect(isValidYm("2026-09-01")).toBe(false);
    expect(isValidYm(undefined)).toBe(false);
  });
});
