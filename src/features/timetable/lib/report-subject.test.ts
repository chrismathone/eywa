import { describe, expect, it } from "vitest";
import { LEGACY_REPORT_SUBJECT, reportMatchesSubject, reportSubject } from "./report-subject";

/**
 * 원장 2026-07-27: "영어 시간표 학생에 호버링하면 '수학 관련 내용'이 나오지 않게 배선 차단",
 * "수학 시간표에서만 수학 관련 내용이 호버링되게",
 * "이후 영어도 aywa에서 발송되면 영어 관련 내용이 '영어 시간표'에서만 호버링되게".
 */
describe("reportSubject — 보고서 과목 판정", () => {
  it("보고서 자체 subject가 최우선(aywa 신규 발송분)", () => {
    expect(reportSubject({ subject: "english", classSubject: "math" })).toBe("english");
  });

  it("subject가 없으면 연결된 반의 과목", () => {
    expect(reportSubject({ subject: null, classSubject: "english" })).toBe("english");
  });

  it("둘 다 없으면 레거시 이관분 = 수학(실측: 14,695건 전부 수학 강사 작성)", () => {
    expect(reportSubject({})).toBe(LEGACY_REPORT_SUBJECT);
    expect(reportSubject({ subject: null, classSubject: null })).toBe("math");
  });

  it("공백만 있는 값은 없는 것으로 본다(임포트 산물에 '' 섞임)", () => {
    expect(reportSubject({ subject: "   ", classSubject: "english" })).toBe("english");
    expect(reportSubject({ subject: "  ", classSubject: " " })).toBe("math");
  });
});

describe("reportMatchesSubject — 시간표 과목별 hover 게이트", () => {
  const legacyMathReport = {}; // 이관분(subject·class 둘 다 없음)

  it("🔴 영어 시간표는 레거시(수학) 보고서를 붙이지 않는다 — 이번 지시의 핵심", () => {
    expect(reportMatchesSubject(legacyMathReport, "english")).toBe(false);
  });

  it("수학 시간표는 레거시 보고서를 그대로 쓴다(안 그러면 수학 hover가 통째로 빈다)", () => {
    expect(reportMatchesSubject(legacyMathReport, "math")).toBe(true);
  });

  it("영어 발송이 시작되면 영어 보고서는 영어 시간표에만 붙는다", () => {
    const englishReport = { subject: "english" };
    expect(reportMatchesSubject(englishReport, "english")).toBe(true);
    expect(reportMatchesSubject(englishReport, "math")).toBe(false);
  });

  it("반 경유 과목도 같은 규칙", () => {
    const viaClass = { subject: null, classSubject: "math" };
    expect(reportMatchesSubject(viaClass, "math")).toBe(true);
    expect(reportMatchesSubject(viaClass, "english")).toBe(false);
  });
});
