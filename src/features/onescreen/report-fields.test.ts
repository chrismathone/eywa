import { describe, it, expect } from "vitest";
import { buildExamInfo, buildReportFields, type ReportFieldSource } from "./report-fields";
import type { Subject, Tests } from "./types";

const tests: Tests = {
  daily: { score: 18, max: 20, prevScore: null },
  check: { score: 95, max: 100, prevScore: null },
};

const subject: Subject = {
  name: "수학 · 고1 특강", // 행 이름엔 반 이름이 붙을 수 있다
  subjectLabel: "수학", // 학부모에게 나가는 값은 **이쪽**
  prev: "",
  today: "1-1-1 백 알아보기",
  textbook: "개념원리 중2-1",
  homeworkToday: "개념편 p10~16",
};

const base: ReportFieldSource = {
  subject,
  homework: "90%",
  attitude: "매우 좋음",
  tests,
  draft: "  오늘 잘했습니다.  ",
  showDailyTest: true,
  showCheckTest: true,
};

describe("buildReportFields", () => {
  it("진도 접두는 반 이름이 아니라 **순수 과목 라벨**", () => {
    // 🔴 name("수학 · 고1 특강")을 쓰면 학부모 카드에 반 이름이 샌다(원장 확정: 반 비노출).
    expect(buildReportFields(base).progress).toBe("수학 1-1-1 백 알아보기");
  });

  it("멘트는 trim하되 **비면 비운다**(템플릿 자동주입 금지 — 2026-07-30 발송 감사)", () => {
    expect(buildReportFields(base).notes).toBe("오늘 잘했습니다.");
    expect(buildReportFields({ ...base, draft: "   " }).notes).toBe("");
  });

  it("테스트 표기는 개수 + '맞음', 비활성 테스트는 값이 있어도 제외", () => {
    const on = buildReportFields(base);
    expect(on.dailyTest).toBe("20문제 중 18개 맞음");
    expect(on.checkTest).toBe("100문제 중 95개 맞음");
    // 학원설정에서 끈 테스트는 세션에 옛 점수가 남아 있어도 저장·표시 둘 다에서 빠진다.
    const off = buildReportFields({ ...base, showDailyTest: false, showCheckTest: false });
    expect(off.dailyTest).toBe("");
    expect(off.checkTest).toBe("");
    expect(off.examInfo).toBe("");
  });

  it("examInfo 합본은 exam_info 규격(미입력 항목 생략)", () => {
    expect(buildExamInfo(tests, true, true)).toBe("일일 18/20, 확인 95/100");
    expect(buildExamInfo({ ...tests, daily: { ...tests.daily, score: null } }, true, true)).toBe("확인 95/100");
    expect(buildExamInfo({ ...tests, daily: { ...tests.daily, score: null }, check: { ...tests.check, score: null } }, true, true)).toBe("");
  });

  it("추세 초안은 비면 undefined(미저장), 과목이 없으면 진도도 빈 문자열", () => {
    expect(buildReportFields({ ...base, trendDraft: "  " }).trendNote).toBeUndefined();
    expect(buildReportFields({ ...base, trendDraft: " 최근 상승 " }).trendNote).toBe("최근 상승");
    expect(buildReportFields({ ...base, subject: undefined }).progress).toBe("");
  });

  it("subjectLabel이 없으면 행 이름으로 폴백(데모·수동 추가 행)", () => {
    const su: Subject = { ...subject, subjectLabel: undefined, name: "수학" };
    expect(buildReportFields({ ...base, subject: su }).progress).toBe("수학 1-1-1 백 알아보기");
  });
});
