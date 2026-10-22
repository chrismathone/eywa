import { z } from "zod";
import type { SystemRole } from "@/lib/permissions";
import { reasonDetailOf } from "@/features/withdrawals/reason-detail";
import { REASON_LABEL } from "@/features/withdrawals/types";

export const REPORT_STATUS = {
  requested: "작성 요청", revision: "반려 · 수정 요청", manager_pending: "관리자 승인 대기",
  director_pending: "원장 승인 대기", scheduled: "처리 예약", completed: "처리 완료",
  blocked: "수강 변경 · 재검토 필요", canceled: "요청 취소",
  approved: "승인 완료 · 다른 보고서 대기",
} as const;
export type ReportStatus = keyof typeof REPORT_STATUS;
export type ReportAction = "save" | "submit" | "approve" | "reject" | "cancel";
export const REPORT_ACTION_LABEL = { request: "작성 요청", save: "임시 저장", submit: "보고서 제출", approve: "승인", reject: "반려", cancel: "요청 취소", apply: "퇴원·수강종료 처리" } as const;
const text = z.string().trim().max(5000, "항목별 5,000자 이내로 입력해 주세요.");
export const bodySchema = z.object({
  reason: z.enum(Object.keys(REASON_LABEL) as [keyof typeof REASON_LABEL, ...Array<keyof typeof REASON_LABEL>]),
  reasonDetail: z.string().max(80).optional(),
  consultationIds: z.array(z.uuid()).max(20).optional(),
  detail: text, studentConsultation: text, parentConsultation: text,
  teacherOpinion: text, attendance: text, tuition: z.string().trim().max(200),
  arrears: z.enum(["unknown", "no", "yes"]), arrearsNote: z.string().trim().max(1000),
}).refine(b => !b.reasonDetail || reasonDetailOf(b.reasonDetail)?.reason === b.reason, { message: "퇴원사유에 맞는 세부 사유를 선택해 주세요.", path: ["reasonDetail"] });
export type ReportBody = z.infer<typeof bodySchema>;
export const EMPTY_BODY: ReportBody = { reason: "other", detail: "", studentConsultation: "", parentConsultation: "", teacherOpinion: "", attendance: "", tuition: "", arrears: "unknown", arrearsNote: "" };
export const requestSchema = z.object({
  studentId: z.uuid(), teacherId: z.uuid(), managerId: z.uuid(), directorId: z.uuid(),
  exitKind: z.enum(["withdrawal", "subject_end"]), subjects: z.array(z.string().min(1).max(80)).min(1).max(20),
  effectiveDate: z.iso.date(), note: z.string().trim().max(1000),
}).superRefine((r, ctx) => {
  if (new Set([r.teacherId, r.managerId, r.directorId]).size !== 3)
    ctx.addIssue({ code: "custom", message: "작성 강사, 관리자, 원장은 서로 다른 사람을 지정해 주세요." });
});
export type ReportRequest = z.infer<typeof requestSchema>;
export const batchRequestSchema = z.object({
  studentId: z.uuid(), teacherIds: z.array(z.uuid()).min(1).max(20), managerIds: z.array(z.uuid()).min(1).max(20),
  directorIds: z.array(z.uuid()).max(20), subjects: z.array(z.string().min(1).max(80)).min(1).max(20),
  effectiveDate: z.iso.date(), note: z.string().trim().max(1000),
}).superRefine((r, ctx) => {
  if (r.teacherIds.some(id => [...r.managerIds, ...r.directorIds].includes(id)) || r.managerIds.some(id => r.directorIds.includes(id)))
    ctx.addIssue({ code: "custom", message: "작성자·관리자·원장을 서로 다르게 지정해 주세요." });
});
export function automaticExitKind(courses: { subject: string }[], subjects: readonly string[]) {
  return courses.length > 0 && courses.every(c => subjects.includes(c.subject)) ? "withdrawal" as const : "subject_end" as const;
}
export type CourseSnapshot = { id: string; classId: string; className: string; subject: string; teacherId: string | null; teacherName: string | null; startDate: string; endDate: string | null; onHold: boolean };
export type StudentSnapshot = { name: string; school: string | null; grade: string | null; enrolledAt: string | null; status: string; withdrawnAt: string | null; courses: CourseSnapshot[] };
export type WithdrawalReport = {
  id: string; tenant_id: string; student_id: string; requested_by: string; teacher_id: string; manager_id: string; director_id: string | null;
  group_id?: string | null; group_leader?: boolean; manager_ids?: string[] | null; director_ids?: string[] | null;
  manager_decisions?: Record<string, string>; director_decisions?: Record<string, string>;
  exit_kind: "withdrawal" | "subject_end"; subjects: string[]; effective_date: string; request_note: string;
  snapshot: StudentSnapshot; body: ReportBody; status: ReportStatus; revision: number;
  manager_approved_at: string | null; director_approved_at: string | null; applied_at: string | null;
  last_comment: string | null; created_at: string; updated_at: string;
};
export type ReportEvent = { id: string; actor_id: string | null; action: keyof typeof REPORT_ACTION_LABEL; from_status: ReportStatus | null; to_status: ReportStatus; comment: string | null; created_at: string };
export type ReportListRow = Omit<WithdrawalReport, "body"> & {
  /** 목록 조회만 싣는 본문의 사유·상세 사유(본문 전체는 상세 화면에서만 읽는다). */
  body_reason?: string | null; body_detail?: string | null; body_reason_detail?: string | null;
};
export type StaffOption = { id: string; name: string; role: SystemRole; subjects: string[]; approvalSubjects?: string[] };
export type StudentOption = { id: string; name: string; school: string | null; grade: string | null; courses: CourseSnapshot[] };
export function snapshotMatches(a: StudentSnapshot, b: StudentSnapshot) {
  const key = (s: StudentSnapshot) => JSON.stringify([s.name, s.school, s.grade, s.enrolledAt, s.status, s.withdrawnAt,
    [...s.courses].sort((x, y) => x.id.localeCompare(y.id)).map(c => [c.id, c.classId, c.className, c.subject, c.teacherId, c.teacherName, c.startDate, c.endDate, c.onHold])]);
  return key(a) === key(b);
}
export function canRequestReport(role: SystemRole) { return role === "master" || role === "admin" || role === "manager"; }
export function managerIds(r: Pick<WithdrawalReport, "manager_id" | "manager_ids">) { return r.manager_ids ?? [r.manager_id]; }
export function directorIds(r: Pick<WithdrawalReport, "director_id" | "director_ids">) { return r.director_ids ?? (r.director_id ? [r.director_id] : []); }
export function isParticipant(r: Pick<WithdrawalReport, "requested_by" | "teacher_id" | "manager_id" | "director_id" | "manager_ids" | "director_ids">, userId: string) {
  return [r.requested_by, r.teacher_id, ...managerIds(r), ...directorIds(r)].includes(userId);
}
export function reportCapabilities(r: WithdrawalReport, userId: string, writable: boolean) {
  const draft = r.status === "requested" || r.status === "revision";
  return {
    edit: writable && draft && r.teacher_id === userId,
    approve: writable && ((r.status === "manager_pending" && managerIds(r).includes(userId) && !r.manager_decisions?.[userId]) || (r.status === "director_pending" && directorIds(r).includes(userId) && !r.director_decisions?.[userId])),
    cancel: writable && r.requested_by === userId && !["completed", "canceled"].includes(r.status),
  };
}
export function submissionError(body: ReportBody): string | null {
  if (Array.from(body.detail.trim()).length < 200) return "퇴원 상세사유를 200자 이상 작성해 주세요.";
  if (!body.studentConsultation.trim() || !body.parentConsultation.trim() || !body.teacherOpinion.trim())
    return "학생·학부모 상담 결과와 담임 의견을 작성해 주세요. 상담하지 못했다면 그 사유를 적어 주세요.";
  return null;
}
export function missingReportSchema(error: { code?: string; message?: string } | null) {
  return !!error && (["42P01", "PGRST205", "PGRST202"].includes(error.code ?? "") || /withdrawal_reports.*schema cache/i.test(error.message ?? ""));
}
