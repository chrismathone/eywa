import { describe, expect, it } from "vitest";
import { jjCaptureWarning, shouldCaptureJj } from "./jj-capture-plan";

describe("shouldCaptureJj", () => {
  it("영어 + 그림 자리 줄이 있을 때만 인재원을 부른다", () => {
    expect(shouldCaptureJj("english", "안녕하세요\n[시험결과지]")).toBe(true);
    expect(shouldCaptureJj("english", "안녕하세요\n[ 학습분석지 ]")).toBe(true);
  });

  it("🔴 수학 저장·그림 없는 영어 글은 부르지 않는다(저장이 느려지지 않게)", () => {
    expect(shouldCaptureJj("math", "[시험결과지]")).toBe(false);
    expect(shouldCaptureJj("english", "그림 없는 글")).toBe(false);
    expect(shouldCaptureJj("english", "문장 속 [시험결과지] 표식은 자리가 아니다")).toBe(false);
    expect(shouldCaptureJj(undefined, "[시험결과지]")).toBe(false);
    expect(shouldCaptureJj("english", null)).toBe(false);
  });
});

describe("jjCaptureWarning", () => {
  it("모든 결과에 한국어 문장이 있다(원문 코드 노출 금지)", () => {
    for (const o of ["unlinked", "fetch_failed", "not_ready", "save_failed"] as const) {
      expect(jjCaptureWarning(o)).toMatch(/[가-힣]/);
      expect(jjCaptureWarning(o)).toContain("그림");
    }
  });
});
