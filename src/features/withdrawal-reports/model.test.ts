import { describe, expect, it } from "vitest";
import { bodySchema, EMPTY_BODY, requestSchema, batchRequestSchema, automaticExitKind, cancelsAsDirector, reportCapabilities, submissionError, missingReportSchema, canRequestReport, directSchema, isBookkeepingReport, isDirectReport, type WithdrawalReport } from "./model";
import { CLEANUP_WITHDRAWAL_MEMO } from "@/features/withdrawals/system-bulk";
const id = "10000000-0000-4000-8000-000000000001";
const teacher = "10000000-0000-4000-8000-000000000002";
const manager = "10000000-0000-4000-8000-000000000003";
const director = "10000000-0000-4000-8000-000000000004";
const request = { studentId: id, teacherId: teacher, managerId: manager, directorId: director, exitKind: "subject_end", subjects: ["math"], effectiveDate: "2026-10-13", note: "" };
const report = { teacher_id: teacher, manager_id: manager, director_id: director, requested_by: manager, status: "requested" } as WithdrawalReport;
describe("withdrawal reports", () => {
  it("accepts only an internal subreason belonging to the selected category", () => {
    expect(bodySchema.safeParse({ ...EMPTY_BODY, reason: "grades", reasonDetail: "school_grades" }).success).toBe(true);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, reason: "grades", reasonDetail: "teacher_left" }).success).toBe(false);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, reasonDetail: "invented" }).success).toBe(false);
  });
  it("allows manager-only final approval and multiple authors without role overlap", () => {
    const batch = { studentId: id, teacherIds: [teacher], managerIds: [manager], directorIds: [], subjects: ["math"], effectiveDate: "2026-10-14", note: "" };
    expect(batchRequestSchema.safeParse(batch).success).toBe(true);
    expect(batchRequestSchema.safeParse({ ...batch, managerIds: [] }).success).toBe(false);
    expect(batchRequestSchema.safeParse({ ...batch, directorIds: [manager] }).success).toBe(false);
    expect(batchRequestSchema.safeParse({ ...batch, managerIds: [teacher] }).success).toBe(false);
  });
  it("infers whole withdrawal only when every enrollment is selected, including same-subject classes", () => {
    const courses = [{ id: "math-a", subject: "math" }, { id: "math-b", subject: "math" }];
    expect(automaticExitKind(courses, ["math-a"])).toBe("subject_end");
    expect(automaticExitKind(courses, ["math-a", "math-b"])).toBe("withdrawal");
    expect(automaticExitKind([], [])).toBe("subject_end");
  });
  it("요청자 또는 원장 이상이 처리 끝 전이면 어느 단계든 취소한다(원장 2026-10-26)", () => {
    const other = "someone";
    for (const status of ["requested", "revision", "manager_pending", "director_pending", "approved", "scheduled", "blocked"] as const) {
      expect(reportCapabilities({ ...report, status }, report.requested_by, true).cancel, status).toBe(true);
      expect(reportCapabilities({ ...report, status }, other, true, true).cancel, status).toBe(true);
      expect(reportCapabilities({ ...report, status }, other, true).cancel, status).toBe(false);
    }
    for (const status of ["completed", "canceled"] as const) expect(reportCapabilities({ ...report, status }, other, true, true).cancel).toBe(false);
    expect(reportCapabilities(report, other, false, true).cancel).toBe(false); // 읽기 전용 보기
    expect(cancelsAsDirector("master", false)).toBe(true);
    expect(cancelsAsDirector("master", true)).toBe(false); // 강사뷰로 보는 중
    expect(cancelsAsDirector("admin", false)).toBe(false);
  });
  it("each appointed reviewer acts once in their stage", () => {
    const multi = { ...report, status: "manager_pending" as const, manager_ids: [manager, "other"], manager_decisions: { [manager]: "2026-10-14" } };
    expect(reportCapabilities(multi, "other", true).approve).toBe(true);
    expect(reportCapabilities(multi, manager, true).approve).toBe(false);
  });
  it("requires two distinct reviewers who are not the author", () => {
    expect(requestSchema.safeParse(request).success).toBe(true);
    for (const invalid of [{ teacherId: manager }, { directorId: manager }, { directorId: teacher }]) expect(requestSchema.safeParse({ ...request, ...invalid }).success).toBe(false);
  });
  it("rejects impossible dates and empty subjects", () => {
    expect(requestSchema.safeParse({ ...request, effectiveDate: "2026-02-30" }).success).toBe(false);
    expect(requestSchema.safeParse({ ...request, subjects: [] }).success).toBe(false);
  });
  it("saves incomplete drafts but requires 100 characters and consultations to submit", () => {
    expect(bodySchema.safeParse(EMPTY_BODY).success).toBe(true);
    expect(submissionError(EMPTY_BODY)).toContain("100자");
    expect(submissionError({ ...EMPTY_BODY, detail: "가".repeat(99) })).toContain("100자");
    expect(submissionError({ ...EMPTY_BODY, detail: "가".repeat(100) })).toContain("상담");
    expect(submissionError({ ...EMPTY_BODY, detail: "가".repeat(100), studentConsultation: "상담하지 못함: 연락 불가", parentConsultation: "상담 완료", teacherOpinion: "검토 의견" })).toBeNull();
  });
  it("does not count padding as a detailed reason", () => {
    expect(submissionError({ ...EMPTY_BODY, detail: " ".repeat(100) + "이유" })).toContain("100자");
  });
  it("rejects oversized or invalid body values", () => {
    expect(bodySchema.safeParse({ ...EMPTY_BODY, detail: "가".repeat(5001) }).success).toBe(false);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, arrears: "nope" }).success).toBe(false);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, tuition: "가".repeat(1001) }).success).toBe(false);
  });
  it("accepts illness and advised exit reasons from the shared withdrawal catalog", () => {
    expect(bodySchema.safeParse({ ...EMPTY_BODY, reason: "illness" }).success).toBe(true);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, reason: "advised" }).success).toBe(true);
  });
  it("author only writes drafts and revisions", () => {
    expect(reportCapabilities(report, teacher, true).edit).toBe(true);
    expect(reportCapabilities(report, manager, true).edit).toBe(false);
    expect(reportCapabilities({ ...report, status: "manager_pending" }, teacher, true).edit).toBe(false);
    expect(reportCapabilities({ ...report, status: "revision" }, teacher, true).edit).toBe(true);
  });
  it("enforces approval order in the UI", () => {
    expect(reportCapabilities({ ...report, status: "manager_pending" }, manager, true).approve).toBe(true);
    expect(reportCapabilities({ ...report, status: "manager_pending" }, director, true).approve).toBe(false);
    expect(reportCapabilities({ ...report, status: "director_pending" }, director, true).approve).toBe(true);
    expect(reportCapabilities({ ...report, status: "director_pending" }, manager, true).approve).toBe(false);
  });
  it("readonly teacher views expose no mutations", () => {
    for (const status of ["requested", "revision", "manager_pending", "director_pending", "scheduled"] as const)
      for (const who of [teacher, manager, director]) expect(Object.values(reportCapabilities({ ...report, status }, who, false))).not.toContain(true);
  });
  it("does not allow cancellation of an applied report", () => {
    expect(reportCapabilities({ ...report, status: "completed" }, manager, true).cancel).toBe(false);
    expect(reportCapabilities({ ...report, status: "scheduled" }, director, true).cancel).toBe(false);
  });
  it("only the sender can cancel, regardless of principal status", () => {
    const capabilities = reportCapabilities({ ...report, status: "director_pending" }, "replacement", true);
    expect(capabilities.cancel).toBe(false);
    expect(reportCapabilities(report, manager, true).cancel).toBe(true);
    expect(capabilities.approve).toBe(false);
    expect(reportCapabilities({ ...report, status: "completed" }, "replacement", true).cancel).toBe(false);
  });
  it("only management requests reports", () => {
    for (const role of ["master", "admin", "manager"] as const) expect(canRequestReport(role)).toBe(true);
    for (const role of ["teacher", "student", "counselor", "viewer"] as const) expect(canRequestReport(role)).toBe(false);
  });
  it("handles old schema separately from operational errors", () => {
    expect(missingReportSchema({ code: "42P01" })).toBe(true);
    expect(missingReportSchema({ code: "PGRST202" })).toBe(true);
    expect(missingReportSchema({ code: "42501" })).toBe(false);
  });
});

/** 관리자 바로 처리(원장 2026-10-23 · 0453a) — 모양 판정과 입력 검사. */
describe("direct processing", () => {
  it("바로 처리 = 작성자 = 승인 관리자 = 요청자(DB CHECK가 표식과 묶는다) · 일반 요청은 작성자와 관리자가 다르다", () => {
    expect(isDirectReport({ teacher_id: manager, manager_id: manager, requested_by: manager })).toBe(true);
    expect(isDirectReport({ teacher_id: teacher, manager_id: manager, requested_by: manager })).toBe(false);
  });
  it("장부 정리가 남긴 바로 처리 보고서만 목록에서 뺀다", () => {
    const direct = { teacher_id: manager, manager_id: manager, requested_by: manager };
    expect(isBookkeepingReport({ ...direct, body_reason: "other", body_detail: CLEANUP_WITHDRAWAL_MEMO })).toBe(true);
    expect(isBookkeepingReport({ ...direct, body_reason: "other", body_detail: "가족 사정" })).toBe(false);
    expect(isBookkeepingReport({ ...direct, body_reason: "relocation", body_detail: CLEANUP_WITHDRAWAL_MEMO })).toBe(false);
    expect(isBookkeepingReport({ teacher_id: teacher, manager_id: manager, requested_by: manager, body_reason: "other", body_detail: CLEANUP_WITHDRAWAL_MEMO })).toBe(false);
  });
  it("입력 — 반 0개 허용(다니는 반 없는 학생) · 사유는 정해진 목록", () => {
    expect(directSchema.safeParse({ studentId: id, enrollmentIds: [], effectiveDate: "2026-10-23", reason: "relocation", memo: "" }).success).toBe(true);
    expect(directSchema.safeParse({ studentId: id, enrollmentIds: [], effectiveDate: "2026-10-23", reason: "nope", memo: "" }).success).toBe(false);
  });
});
