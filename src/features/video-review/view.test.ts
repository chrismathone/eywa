import { describe, expect, it } from "vitest";
import { canRerunReview } from "./view";

describe("영상 AI 메모 다시 분석 표시", () => {
  it("전사와 자료가 있어도 AI 분석이 꺼졌으면 숨긴다", () => {
    expect(canRerunReview("done", true, true, false)).toBe(false);
  });

  it("침산 조건처럼 AI 분석이 켜졌으면 종전 조건을 따른다", () => {
    expect(canRerunReview("done", true, true, true)).toBe(true);
    expect(canRerunReview("judging", true, true, true)).toBe(false);
  });
});
