import { describe, expect, it } from "vitest";
import { EMPTY_BODY, type CourseSnapshot } from "./model";
import { attendancePrefill, billingPrefill, fillEmptyReportFields, type AttendancePrefillRow } from "./prefill";

const course: CourseSnapshot = { id: "enrollment", classId: "class", className: "수학반", subject: "math", teacherId: "teacher", teacherName: "담임", startDate: "2026-10-01", endDate: null, onHold: false };
const attendance: AttendancePrefillRow = { id: "a", student_id: "student", class_id: "class", session_date: "2026-10-02", slot_start: "16:00", status: "absent", recorded_at: "2026-10-02T08:00:00Z" };
const invoice = { period: "2026-10", category: "tuition", status: "partial", amountTotal: 300000, amountDiscount: 50000, amountPaid: 100000 };

describe("report automatic fields", () => {
  it("uses corrected attendance, counts distinct periods, and excludes other classes and dates before enrollment", () => {
    const result = attendancePrefill([attendance, { ...attendance, id: "b", status: "present", recorded_at: "2026-10-02T09:00:00Z" }, { ...attendance, id: "c", slot_start: "18:00", status: "late" }, { ...attendance, id: "d", class_id: "other" }, { ...attendance, id: "e", session_date: "2026-09-30" }], [course], "2026-09-23", "2026-10-22");
    expect(result).toContain("전체 2회 / 출석 1회 / 지각 1회 / 결석 0회");
    expect(attendancePrefill([], [course], "2026-09-23", "2026-10-22")).toContain("기록 없음");
  });
  it("uses discounted amounts and the shared outstanding rule, separating the report month from older debt", () => {
    const result = billingPrefill([invoice, { ...invoice, period: "2026-09", category: "material", amountTotal: 20000, amountDiscount: 0, amountPaid: 0 }, { ...invoice, status: "paid" }, { ...invoice, status: "void" }, { ...invoice, status: "refunded" }, { ...invoice, period: "2026-11" }], "2026-10", "2026-10-22");
    expect(result.tuition).toBe("2026-10 학생 전체 수강료 청구 500,000원 · 미수 150,000원");
    expect(result.arrears).toBe("yes");
    expect(result.arrearsNote).toContain("미수 170,000원");
  });
  it("never treats missing bills as paid, and respects paid status even when credit leaves an amount difference", () => {
    expect(billingPrefill([], "2026-10", "2026-10-22").arrears).toBe("unknown");
    expect(billingPrefill([{ ...invoice, status: "paid" }], "2026-10", "2026-10-22").arrears).toBe("no");
  });
  it("refreshes financial fields while preserving authored text", () => {
    const body = { ...EMPTY_BODY, tuition: "확인한 원비", attendance: "직접 확인", arrears: "yes" as const, arrearsNote: "확인 메모" };
    expect(fillEmptyReportFields(body, { tuition: "자동", attendance: "자동", arrears: "no", arrearsNote: "자동", detail: "자동" })).toEqual({ ...body, tuition: "자동", arrears: "no", arrearsNote: "자동" });
    expect(fillEmptyReportFields(EMPTY_BODY, { tuition: "자동", attendance: "자동", arrears: "no" })).toMatchObject({ tuition: "자동", attendance: "자동", arrears: "no", detail: "", studentConsultation: "", parentConsultation: "", teacherOpinion: "" });
  });
});
