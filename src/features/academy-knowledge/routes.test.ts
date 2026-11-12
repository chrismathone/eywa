import { describe, expect, it } from "vitest";
import { liveHref } from "./routes";

describe("스키마 스튜디오 화면 링크", () => {
  it("스위치를 넘기지 않거나 전부 켜면 기존 주소를 그대로 쓴다", () => {
    expect(liveHref("/approvals/123")).toBe("/approvals/123");
    expect(liveHref("/lesson-reports?student=s1", { classnote: true })).toBe("/lesson-reports?student=s1");
  });

  it("꺼진 모듈의 주소만 링크에서 뺀다", () => {
    expect(liveHref("/approvals/123", { approvals: false })).toBeNull();
    expect(liveHref("/lesson-reports?student=s1", { classnote: false })).toBeNull();
    expect(liveHref("/students/s1", { approvals: false, classnote: false })).toBe("/students/s1");
  });
});
