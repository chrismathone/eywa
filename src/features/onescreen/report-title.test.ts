import { describe, expect, it } from "vitest";
import { reportTitleText, subjectReportLabel } from "./report-title";

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
  it("🔴 과목 보고서(원장 2026-10-16) — 설정 제목이 비었거나 기본값이면 과목 이름 + 보고서", () => {
    expect(reportTitleText("수업 보고서", { subjectLabel: "수학" })).toBe("수학 보고서");
    expect(reportTitleText("", { subjectLabel: "영어" })).toBe("영어 보고서");
    expect(reportTitleText(null, { subjectLabel: "수학", special: true, makeup: true })).toBe("[특강] 수학 보고서 (보강)");
    // 원장이 정한 다른 제목은 그대로 · 과목을 모르면 기본값
    expect(reportTitleText("주간 학습 리포트", { subjectLabel: "수학" })).toBe("주간 학습 리포트");
    expect(reportTitleText("수업 보고서", { subjectLabel: null })).toBe("수업 보고서");
    expect(reportTitleText("수업보고서", { subjectLabel: "영어" })).toBe("영어 보고서"); // 띄어쓰기만 다른 기본값
  });
  it("과목 이름 = 학원 설정 — 키가 없거나 설정에 없어 키가 그대로 돌아오면 null", () => {
    const labelOf = (k: string) => ({ math: "수학", english: "영어" })[k] ?? k;
    expect(subjectReportLabel(labelOf, "math")).toBe("수학");
    expect(subjectReportLabel(labelOf, "subject_7")).toBeNull();
    expect(subjectReportLabel(labelOf, null)).toBeNull();
  });
});
