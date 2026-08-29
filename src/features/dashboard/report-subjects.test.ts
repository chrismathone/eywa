import { describe, expect, it } from "vitest";
import { isReportTrackedSubject } from "./report-subjects";

describe("isReportTrackedSubject", () => {
  it("설정에 있는 과목만 센다 — 영어는 빠진다(원장 2026-08-29)", () => {
    expect(isReportTrackedSubject("math", ["math"])).toBe(true);
    expect(isReportTrackedSubject("english", ["math"])).toBe(false);
  });

  it("🔴 목록이 비면 전부 센다 — 설정이 비는 순간 신호가 조용히 사라지면 안 된다", () => {
    expect(isReportTrackedSubject("english", [])).toBe(true);
    expect(isReportTrackedSubject("english", null)).toBe(true);
    expect(isReportTrackedSubject("english", undefined)).toBe(true);
  });

  it("공백만 든 목록도 '미설정'으로 본다", () => {
    expect(isReportTrackedSubject("english", ["  ", ""])).toBe(true);
  });

  it("과목이 없으면 목록이 있을 때 제외(발송 게이트와 같은 결)", () => {
    expect(isReportTrackedSubject(null, ["math"])).toBe(false);
    expect(isReportTrackedSubject("", ["math"])).toBe(false);
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(isReportTrackedSubject(" math ", [" math "])).toBe(true);
  });

  it("여러 과목을 켜면 둘 다 센다(영어를 eywa로 옮길 때의 경로)", () => {
    expect(isReportTrackedSubject("english", ["math", "english"])).toBe(true);
  });
});
