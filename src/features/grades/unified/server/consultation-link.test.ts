import { describe, expect, it } from "vitest";
import {
  consultationDateFor, linkedConsultationDates, linkedConsultationSummary, recordKey,
  type LinkedConsultation,
} from "./consultation-link";

const gradeId = "11111111-1111-4111-8111-111111111111";
const otherGradeId = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";

function consultation(over: Partial<LinkedConsultation> = {}): LinkedConsultation {
  return {
    student_id: "student-1", subject: "math", category: "academic",
    consulted_at: "2026-09-22T12:00:00+09:00",
    summary: linkedConsultationSummary({
      studentId: "student-1", subject: "math", date: "2026-09-22", recordKey: recordKey("grade", gradeId),
    }),
    ...over,
  };
}

describe("성적 원장 상담 연결", () => {
  it("상담 본문은 시험일·과목을 복제하지 않아 별도 필드 수정 후에도 낡지 않는다", () => {
    expect(linkedConsultationSummary({ studentId: "student-1", subject: "math", date: "2026-09-21", recordKey: recordKey("grade", gradeId) }))
      .toBe(linkedConsultationSummary({ studentId: "student-1", subject: "science", date: "2026-09-23", recordKey: recordKey("grade", gradeId) }));
  });

  it("학생·과목·시험 행 키가 모두 일치하는 명시적 학습 상담만 연결한다", () => {
    const unlinked = linkedConsultationDates([
      consultation({ summary: "성적 상담" }),
      consultation({ summary: "9월 월말평가 점수 상담" }),
    ]);
    expect(consultationDateFor(unlinked, "student-1", "math", recordKey("grade", gradeId))).toBeNull();
    const dates = linkedConsultationDates([
      consultation(),
      consultation({ category: "general" }),
      consultation({ subject: "english" }),
      consultation({ student_id: "student-2" }),
    ]);
    expect(consultationDateFor(dates, "student-1", "math", recordKey("grade", gradeId))).toBe("2026-09-22");
    expect(consultationDateFor(dates, "student-1", "math", recordKey("grade", otherGradeId))).toBeNull();
    expect(consultationDateFor(dates, "student-3", "math", recordKey("grade", gradeId))).toBeNull();
    expect(consultationDateFor(dates, "student-1", "science", recordKey("grade", gradeId))).toBeNull();
  });

  it("보고서의 일일·확인 시험을 서로 구분하고 KST 상담일 중 가장 최근 날짜를 표시한다", () => {
    const daily = recordKey("report", reportId, "daily");
    const dates = linkedConsultationDates([
      consultation({ summary: linkedConsultationSummary({ studentId: "student-1", subject: "math", date: "2026-09-21", recordKey: daily }), consulted_at: "2026-09-21T23:30:00+09:00" }),
      consultation({ summary: linkedConsultationSummary({ studentId: "student-1", subject: "math", date: "2026-09-23", recordKey: daily }), consulted_at: "2026-09-23T00:30:00+09:00" }),
    ]);
    expect(consultationDateFor(dates, "student-1", "math", daily)).toBe("2026-09-23");
    expect(consultationDateFor(dates, "student-1", "math", recordKey("report", reportId, "check"))).toBeNull();
  });

  it("기존 보고서의 legacy 행 키를 other 저장 요청과 정확히 맞춘다", () => {
    const legacy = recordKey("report", reportId, "other");
    expect(legacy).toBe(`report:${reportId}:legacy`);
    const dates = linkedConsultationDates([
      consultation({ summary: linkedConsultationSummary({ studentId: "student-1", subject: "math", date: "2026-09-22", recordKey: legacy }) }),
    ]);
    expect(consultationDateFor(dates, "student-1", "math", `report:${reportId}:legacy`)).toBe("2026-09-22");
    expect(consultationDateFor(dates, "student-1", "math", `report:${reportId}:other`)).toBeNull();
  });
});
