import { describe, expect, it } from "vitest";
import { EMPTY_BODY, type CourseSnapshot } from "./model";
import { attendancePrefill, billingPrefill, fillEmptyReportFields, liveBillingForSubmitted, withoutBillingFields, type AttendancePrefillRow } from "./prefill";

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
    // 원장 2026-10-29 "정확하게 언제껀지" — 달·항목별(오래된 달부터)
    expect(result.arrearsNote).toBe("2026-10-22 조회 · 미수 170,000원 — 2026-09 교재 20,000원, 2026-10 수강료 150,000원");
    expect(billingPrefill([{ ...invoice, status: "paid", amountPaid: 250000 }], "2026-10", "2026-10-22").arrearsNote).toBe("2026-10-22 조회 · 2026-10까지 학생 전체 청구 미수 없음");
  });
  it("제출한 보고서는 지금 장부로 보이고, 제출 때와 다르면 그 값을 덧붙인다(김소은 2026-10-29)", () => {
    const stored = { ...EMPTY_BODY, arrears: "yes" as const, arrearsNote: "2026-10-26 조회 · 미수 19,000원 — 2026-10 수강료 19,000원" };
    const live = { arrears: "no" as const, arrearsNote: "2026-10-29 조회 · 2026-10까지 학생 전체 청구 미수 없음" };
    expect(liveBillingForSubmitted(stored, live).arrearsNote).toBe(`${live.arrearsNote}\n(제출 때: 미납 ${stored.arrearsNote})`);
    expect(liveBillingForSubmitted(stored, live).arrears).toBe("no");
    // 날짜만 다르면 덧붙이지 않는다
    expect(liveBillingForSubmitted(stored, { arrears: "yes", arrearsNote: "2026-10-29 조회 · 미수 19,000원 — 2026-10 수강료 19,000원" }).arrearsNote).not.toContain("제출 때");
    // 옛 형식으로 저장된 것도 금액이 같으면 덧붙이지 않는다
    const old = { ...EMPTY_BODY, arrears: "no" as const, arrearsNote: "2026-10-20 조회 · 2026-10까지 등록된 학생 전체 청구 기준 미수 0원" };
    expect(liveBillingForSubmitted(old, { arrears: "no", arrearsNote: "2026-10-29 조회 · 2026-10까지 학생 전체 청구 미수 없음" }).arrearsNote).not.toContain("제출 때");
    // 원비만 바뀌어도 흔적을 남긴다
    const t = { ...EMPTY_BODY, tuition: "2026-10 학생 전체 수강료 청구 533,000원 · 미수 19,000원", arrears: "no" as const, arrearsNote: "x 미수 없음" };
    expect(liveBillingForSubmitted(t, { tuition: "2026-10 학생 전체 수강료 청구 514,000원 · 미수 0원", arrears: "no", arrearsNote: "y 미수 없음" }).arrearsNote).toContain("제출 때: 원비 2026-10 학생 전체 수강료 청구 533,000원");
  });
  it("미수 항목이 많으면 12건까지 적고 나머지는 건수로 — 칸 상한(1,000자) 안", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...invoice, period: `20${10 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` }));
    const note = billingPrefill(many, "2026-10", "2026-10-22").arrearsNote!;
    expect(note).toMatch(/외 28건$/);
    expect(note.length).toBeLessThan(1000);
  });
  it("저장 입력의 수납 칸은 비운다(서버가 장부로 다시 채운다)", () => {
    expect(withoutBillingFields({ detail: "d", arrearsNote: "x".repeat(2000), tuition: "t", arrears: "yes" })).toEqual({ detail: "d", arrearsNote: "", tuition: "", arrears: "unknown" });
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
