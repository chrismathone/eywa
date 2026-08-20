import { describe, expect, it } from "vitest";
import {
  EMPTY_RECORD_COUNTS,
  enrollmentDeleteBlockReason,
  summarizeRecordCounts,
  type EnrollmentRecordCounts,
} from "./deletable";

const counts = (patch: Partial<EnrollmentRecordCounts> = {}): EnrollmentRecordCounts => ({
  ...EMPTY_RECORD_COUNTS,
  ...patch,
});

describe("enrollmentDeleteBlockReason", () => {
  it("기록이 하나도 없으면 지울 수 있다(잘못 만든 배정 취소 행)", () => {
    expect(
      enrollmentDeleteBlockReason({ counts: counts(), hasSiblingEnrollment: false }),
    ).toBeNull();
  });

  it("출결이 있으면 거절 — 몇 건인지와 대안을 함께 말한다", () => {
    const reason = enrollmentDeleteBlockReason({
      counts: counts({ attendance: 3 }),
      hasSiblingEnrollment: false,
    });
    expect(reason).toContain("출결 3건");
    expect(reason).toContain("수강 종료");
  });

  it("여러 종류가 있으면 나열한다(중요한 것부터)", () => {
    const reason =
      enrollmentDeleteBlockReason({
        counts: counts({ attendance: 2, lessonReports: 1 }),
        hasSiblingEnrollment: false,
      }) ?? "";
    expect(reason.indexOf("출결 2건")).toBeLessThan(reason.indexOf("수업보고서 1건"));
  });

  it("4종 이상이면 앞 3종 + '외 N종'으로 줄인다", () => {
    const reason =
      enrollmentDeleteBlockReason({
        counts: counts({ attendance: 1, lessonReports: 1, onescreenSessions: 1, billing: 1, followups: 1 }),
        hasSiblingEnrollment: false,
      }) ?? "";
    expect(reason).toContain("외 2종");
  });

  it("청구·회차만 있어도 거절한다", () => {
    expect(
      enrollmentDeleteBlockReason({ counts: counts({ billing: 1 }), hasSiblingEnrollment: false }),
    ).toContain("청구·회차 1건");
  });

  it("🔴 같은 (학생,반)에 다른 수강이 남으면 기록이 있어도 허용 — 기록은 그쪽이 주인이다", () => {
    expect(
      enrollmentDeleteBlockReason({
        counts: counts({ attendance: 40, lessonReports: 12, billing: 3 }),
        hasSiblingEnrollment: true,
      }),
    ).toBeNull();
  });

  it("이유 문구에 표 이름(raw)이 새지 않는다", () => {
    const reason =
      enrollmentDeleteBlockReason({
        counts: counts({ attendance: 1, sheetMarks: 1 }),
        hasSiblingEnrollment: false,
      }) ?? "";
    expect(reason).not.toMatch(/attendance_records|lesson_reports|class_sheet|invoice/);
  });
});

describe("summarizeRecordCounts", () => {
  it("기록이 없으면 null", () => {
    expect(summarizeRecordCounts(counts())).toBeNull();
  });

  it("있는 것만 모아 한 줄로(줄이지 않는다 — 감사로그·확인창용)", () => {
    expect(summarizeRecordCounts(counts({ attendance: 2, followups: 1 }))).toBe(
      "출결 2건 · 후속조치 1건",
    );
  });
});
