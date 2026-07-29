import { describe, expect, it } from "vitest";
import { ownsTextbookRequest } from "./textbook-ownership";

describe("ownsTextbookRequest", () => {
  it("표시명이 정확히 같으면 내 것", () => {
    expect(ownsTextbookRequest("김민주", "김민주")).toBe(true);
  });

  it("앞뒤 공백은 무시한다(저장 시 흔들리는 값)", () => {
    expect(ownsTextbookRequest(" 김민주 ", "김민주")).toBe(true);
  });

  // 🔴 이 케이스가 2026-07-29 감사의 본체다 — 수학·영어를 같이 듣는 학생은 두 강사 모두의 담당이라
  //    담당 학생 게이트만으로는 영어 강사가 수학 강사의 요청을 수정·삭제·발송할 수 있었다.
  it("다른 강사의 요청은 내 것이 아니다", () => {
    expect(ownsTextbookRequest("김민주", "추민아")).toBe(false);
  });

  it("표기 흔들림은 **일부러** 안 맞춘다 — 느슨하게 하면 남의 것을 내 것으로 오판한다", () => {
    expect(ownsTextbookRequest("셀린T", "셀린t")).toBe(false);
    expect(ownsTextbookRequest("김정은T", "김정은")).toBe(false);
  });

  it("양쪽 중 하나라도 비면 fail-closed", () => {
    expect(ownsTextbookRequest(null, "김민주")).toBe(false);
    expect(ownsTextbookRequest("김민주", null)).toBe(false);
    expect(ownsTextbookRequest("", "")).toBe(false);
    expect(ownsTextbookRequest("   ", "   ")).toBe(false);
    expect(ownsTextbookRequest(undefined, undefined)).toBe(false);
  });
});
