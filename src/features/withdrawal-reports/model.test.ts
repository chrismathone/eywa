import { describe, expect, it } from "vitest";
import { bodySchema, EMPTY_BODY, requestSchema, batchRequestSchema, automaticExitKind, reportCapabilities, submissionError, missingReportSchema, canRequestReport, type WithdrawalReport } from "./model";
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
  it("infers whole withdrawal only when every actual subject is selected", () => {
    expect(automaticExitKind([{ subject: "math" }, { subject: "english" }], ["math"])).toBe("subject_end");
    expect(automaticExitKind([{ subject: "math" }, { subject: "english" }], ["math", "english"])).toBe("withdrawal");
    expect(automaticExitKind([], [])).toBe("subject_end");
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
  it("saves incomplete drafts but requires 200 characters and consultations to submit", () => {
    expect(bodySchema.safeParse(EMPTY_BODY).success).toBe(true);
    expect(submissionError(EMPTY_BODY)).toContain("200자");
    expect(submissionError({ ...EMPTY_BODY, detail: "가".repeat(200) })).toContain("상담");
    expect(submissionError({ ...EMPTY_BODY, detail: "가".repeat(200), studentConsultation: "상담하지 못함: 연락 불가", parentConsultation: "상담 완료", teacherOpinion: "검토 의견" })).toBeNull();
  });
  it("does not count padding as a detailed reason", () => {
    expect(submissionError({ ...EMPTY_BODY, detail: " ".repeat(200) + "이유" })).toContain("200자");
  });
  it("rejects oversized or invalid body values", () => {
    expect(bodySchema.safeParse({ ...EMPTY_BODY, detail: "가".repeat(5001) }).success).toBe(false);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, arrears: "nope" }).success).toBe(false);
    expect(bodySchema.safeParse({ ...EMPTY_BODY, tuition: "가".repeat(201) }).success).toBe(false);
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
