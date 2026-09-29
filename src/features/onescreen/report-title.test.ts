import { describe, expect, it } from "vitest";
import { reportTitleText } from "./report-title";

describe("reportTitleText — 학부모 보고서 제목(원장 2026-09-30 '[특강] 수업보고서')", () => {
  it("정규 = 설정 제목 그대로(없으면 기본)", () => {
    expect(reportTitleText("", {})).toBe("수업 보고서");
    expect(reportTitleText("수학 수업 보고서", {})).toBe("수학 수업 보고서");
  });
  it("🔴 특강 = 앞에 [특강]", () => {
    expect(reportTitleText("", { special: true })).toBe("[특강] 수업 보고서");
  });
  it("보강 접미사와 함께", () => {
    expect(reportTitleText("", { special: true, makeup: true, hasClass: true })).toBe("[특강] 수업 보고서 (정규+보강)");
    expect(reportTitleText("", { makeup: true })).toBe("수업 보고서 (보강)");
  });
});
