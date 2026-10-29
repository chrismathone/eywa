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
    const result = billingPrefill([invoice, { ...invoice, period: "2026-09", category: "material", amountTotal: 20000, amountDiscount: 0, amountPaid: 0 }, { ...invoice, status: "paid" }, { ...invoice, status: "void" }, { ...invoice, status: "refunded" }, { ...invoice, period: "2026-11" }], "2026-10");
    expect(result.tuition).toBe("2026-10 수강료 청구 500,000원 · 미수 150,000원");
    expect(result.arrears).toBe("yes");
    // 원장 2026-10-29 "있을때만 어떤건인지" — 오래된 달부터, 줄 기록이 없으면 청구 단위
    expect(result.arrearsNote).toBe("미수 170,000원\n· 2026-09 교재 미납 20,000원\n· 2026-10 수강료 미납 150,000원");
    // "미납 없음 한마디로 끝" — 메모 없음
    expect(billingPrefill([{ ...invoice, status: "paid", amountPaid: 250000 }], "2026-10").arrearsNote).toBe("");
  });
  it("원비·미납은 수납 청구 줄을 그대로 보인다(원장 2026-10-29)", () => {
    const lines = [
      { kind: "수업", description: "중등E_중2 심화 Jane", amount: 325000, discount: 10000, paid: 315000, unpaid: 0 },
      { kind: "수업", description: "중2 수학 A", amount: 200000, paid: 181000, unpaid: 19000 },
    ];
    const result = billingPrefill([{ ...invoice, amountTotal: 525000, amountDiscount: 10000, amountPaid: 496000, lines }], "2026-10");
    expect(result.tuition).toBe("2026-10 수강료 청구 515,000원 · 미수 19,000원\n· 수업 중등E_중2 심화 Jane 325,000원(할인 10,000원) · 납부 315,000원\n· 수업 중2 수학 A 200,000원 · 납부 181,000원 · 미납 19,000원");
    expect(result.arrearsNote).toBe("미수 19,000원\n· 2026-10 수업 중2 수학 A 미납 19,000원");
  });
  it("제출한 보고서는 지금 장부로 보이고, 제출 때와 다르면 그 값을 덧붙인다(김소은 2026-10-29)", () => {
    const stored = { ...EMPTY_BODY, arrears: "yes" as const, arrearsNote: "2026-10-26 조회 · 미수 19,000원 — 2026-10 수강료 19,000원" };
    const live = { arrears: "no" as const, arrearsNote: "" };
    expect(liveBillingForSubmitted(stored, live).arrearsNote).toBe(`(제출 때: 미납 ${stored.arrearsNote})`);
    expect(liveBillingForSubmitted(stored, live).arrears).toBe("no");
    // 형식만 다르면 덧붙이지 않는다
    expect(liveBillingForSubmitted(stored, { arrears: "yes", arrearsNote: "미수 19,000원\n· 2026-10 수강료 미납 19,000원" }).arrearsNote).not.toContain("제출 때");
    const old = { ...EMPTY_BODY, arrears: "no" as const, arrearsNote: "2026-10-20 조회 · 2026-10까지 등록된 학생 전체 청구 기준 미수 0원" };
    expect(liveBillingForSubmitted(old, live).arrearsNote).toBe("");
    // 원비는 첫 줄 금액으로 비교 — 옛 문구와 같은 금액이면 그대로, 다르면 흔적
    const t = { ...EMPTY_BODY, tuition: "2026-10 학생 전체 수강료 청구 533,000원 · 미수 19,000원", arrears: "no" as const, arrearsNote: "" };
    expect(liveBillingForSubmitted(t, { tuition: "2026-10 수강료 청구 533,000원 · 미수 19,000원\n· 수업 A 533,000원", arrears: "no", arrearsNote: "" }).arrearsNote).toBe("");
    expect(liveBillingForSubmitted(t, { tuition: "2026-10 수강료 청구 514,000원 · 미수 0원", arrears: "no", arrearsNote: "" }).arrearsNote).toBe("(제출 때: 원비 2026-10 학생 전체 수강료 청구 533,000원 · 미수 19,000원 · 미납 없음)");
  });
  it("미수 항목이 많으면 칸 상한(1,000자) 안에서 자르고 나머지는 건수로", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...invoice, period: `20${10 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` }));
    const note = billingPrefill(many, "2026-10").arrearsNote!;
    expect(note).toMatch(/외 \d+건$/);
    expect(note.length).toBeLessThanOrEqual(1000);
  });
  it("저장 입력의 수납 칸은 비운다(서버가 장부로 다시 채운다)", () => {
    expect(withoutBillingFields({ detail: "d", arrearsNote: "x".repeat(2000), tuition: "t", arrears: "yes" })).toEqual({ detail: "d", arrearsNote: "", tuition: "", arrears: "unknown" });
  });
  it("never treats missing bills as paid, and respects paid status even when credit leaves an amount difference", () => {
    expect(billingPrefill([], "2026-10").arrears).toBe("unknown");
    expect(billingPrefill([{ ...invoice, status: "paid" }], "2026-10").arrears).toBe("no");
  });
  it("refreshes financial fields while preserving authored text", () => {
    const body = { ...EMPTY_BODY, tuition: "확인한 원비", attendance: "직접 확인", arrears: "yes" as const, arrearsNote: "확인 메모" };
    expect(fillEmptyReportFields(body, { tuition: "자동", attendance: "자동", arrears: "no", arrearsNote: "자동", detail: "자동" })).toEqual({ ...body, tuition: "자동", arrears: "no", arrearsNote: "자동" });
    expect(fillEmptyReportFields(EMPTY_BODY, { tuition: "자동", attendance: "자동", arrears: "no" })).toMatchObject({ tuition: "자동", attendance: "자동", arrears: "no", detail: "", studentConsultation: "", parentConsultation: "", teacherOpinion: "" });
  });
});
