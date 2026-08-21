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

/** 티어 인자는 대부분의 케이스에서 무관 — 기본 false로 두고 티어 절에서만 명시한다. */
const check = (input: {
  counts?: Partial<EnrollmentRecordCounts>;
  hasSiblingEnrollment: boolean;
  thisRowHasTier?: boolean;
  siblingHasTier?: boolean;
}) =>
  enrollmentDeleteBlockReason({
    counts: counts(input.counts),
    hasSiblingEnrollment: input.hasSiblingEnrollment,
    thisRowHasTier: input.thisRowHasTier ?? false,
    siblingHasTier: input.siblingHasTier ?? false,
  });

describe("enrollmentDeleteBlockReason", () => {
  it("기록이 하나도 없으면 지울 수 있다(잘못 만든 배정 취소 행)", () => {
    expect(check({ hasSiblingEnrollment: false })).toBeNull();
  });

  it("출결이 있으면 거절 — 몇 건인지와 대안을 함께 말한다", () => {
    const reason = check({ counts: { attendance: 3 }, hasSiblingEnrollment: false });
    expect(reason).toContain("출결 3건");
    expect(reason).toContain("수강 종료");
  });

  it("여러 종류가 있으면 나열한다(중요한 것부터)", () => {
    const reason = check({ counts: { attendance: 2, lessonReports: 1 }, hasSiblingEnrollment: false }) ?? "";
    expect(reason.indexOf("출결 2건")).toBeLessThan(reason.indexOf("수업보고서 1건"));
  });

  it("4종 이상이면 앞 3종 + '외 N종'으로 줄인다", () => {
    const reason =
      check({
        counts: { attendance: 1, lessonReports: 1, onescreenSessions: 1, billing: 1, followups: 1 },
        hasSiblingEnrollment: false,
      }) ?? "";
    expect(reason).toContain("외 2종");
  });

  it("청구·회차만 있어도 거절한다", () => {
    expect(check({ counts: { billing: 1 }, hasSiblingEnrollment: false })).toContain("청구·회차 1건");
  });

  it("🔴 같은 (학생,반)에 다른 수강이 남으면 기록이 있어도 허용 — 기록은 그쪽이 주인이다", () => {
    expect(
      check({ counts: { attendance: 40, lessonReports: 12, billing: 3 }, hasSiblingEnrollment: true }),
    ).toBeNull();
  });

  it("이유 문구에 표 이름(raw)이 새지 않는다", () => {
    const reason = check({ counts: { attendance: 1, sheetMarks: 1 }, hasSiblingEnrollment: false }) ?? "";
    expect(reason).not.toMatch(/attendance_records|lesson_reports|class_sheet|invoice/);
  });
});

describe("급여 단가(티어) 예외 — 형제 탈출구를 그만큼만 좁힌다", () => {
  it("🔴 이 행에만 티어가 있고 출결이 붙어 있으면 거절 — 지우면 정산액이 조용히 줄어든다", () => {
    const reason = check({
      counts: { attendance: 12 },
      hasSiblingEnrollment: true,
      thisRowHasTier: true,
      siblingHasTier: false,
    });
    expect(reason).toContain("급여 단가");
    expect(reason).toContain("정산액");
  });

  it("형제에도 티어가 있으면 매핑이 남는다 — 허용", () => {
    expect(
      check({
        counts: { attendance: 12 },
        hasSiblingEnrollment: true,
        thisRowHasTier: true,
        siblingHasTier: true,
      }),
    ).toBeNull();
  });

  it("티어가 있어도 출결이 0이면 허용 — 시수 0이라 돈이 안 움직인다", () => {
    expect(
      check({
        counts: { lessonReports: 3 },
        hasSiblingEnrollment: true,
        thisRowHasTier: true,
        siblingHasTier: false,
      }),
    ).toBeNull();
  });

  it("이 행에 티어가 없으면(형제만 티어) 매핑이 안 사라진다 — 허용", () => {
    expect(
      check({
        counts: { attendance: 12 },
        hasSiblingEnrollment: true,
        thisRowHasTier: false,
        siblingHasTier: true,
      }),
    ).toBeNull();
  });

  it("⚠️ 형제가 없고 기록이 전부 0이면 티어가 있어도 허용 — zero-length 정정 행이 그 모양이다", () => {
    expect(
      check({ hasSiblingEnrollment: false, thisRowHasTier: true, siblingHasTier: false }),
    ).toBeNull();
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
