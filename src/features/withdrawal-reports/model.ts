import { z } from "zod";
import type { SystemRole } from "@/lib/permissions";
import type { SubjectHistoryRow } from "./course-period";
import { reasonDetailOf } from "@/features/withdrawals/reason-detail";
import { REASON_LABEL } from "@/features/withdrawals/types";
import { CLEANUP_WITHDRAWAL_MEMO } from "@/features/withdrawals/system-bulk";

export const REPORT_STATUS = {
  requested: "작성 요청", revision: "반려 · 수정 요청", manager_pending: "관리자 승인 대기",
  director_pending: "원장 승인 대기", scheduled: "처리 예약", completed: "처리 완료",
  blocked: "수강 변경 · 재검토 필요", canceled: "요청 취소",
  approved: "승인 완료 · 다른 보고서 대기",
} as const;
export type ReportStatus = keyof typeof REPORT_STATUS;
export type ReportAction = "save" | "submit" | "approve" | "reject" | "cancel";
/** 처리 이력 이름 — `refund`(보고서에서 데스크 환불 요청) · `release`(데스크 환불 완료 뒤 처리)는 s2_0020(원장 2026-11-03). */
export const REPORT_ACTION_LABEL = { request: "작성 요청", save: "임시 저장", submit: "보고서 제출", approve: "승인", reject: "반려", cancel: "요청 취소", apply: "퇴원·수강종료 처리", direct: "관리자 바로 처리", refund: "데스크 환불 요청", release: "데스크 환불 완료 · 처리" } as const;
const text = z.string().trim().max(5000, "항목별 5,000자 이내로 입력해 주세요.");
export const bodySchema = z.object({
  reason: z.enum(Object.keys(REASON_LABEL) as [keyof typeof REASON_LABEL, ...Array<keyof typeof REASON_LABEL>]),
  reasonDetail: z.string().max(80).optional(),
  consultationIds: z.array(z.uuid()).max(20).optional(),
  detail: text, studentConsultation: text, parentConsultation: text,
  teacherOpinion: text, attendance: text, tuition: z.string().trim().max(1000),
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
/**
 * 작성 요청 입력 — 원장 승인 칸은 없다(원장 2026-11-03 · 옛 화면이 보낸 `directorIds`는 버린다 — zod가 모르는 칸을 뺀다, DB도 받지 않는다).
 * 관리자 0명 = 관리자 승인 생략(작성 강사가 모두 그 과목 관리자)일 때만 — 서버 액션이 과목으로 다시 가리고(`managerStepSkippable`) DB가 역할로 막는다.
 */
export const batchRequestSchema = z.object({
  studentId: z.uuid(), teacherIds: z.array(z.uuid()).min(1).max(20), managerIds: z.array(z.uuid()).max(20),
  enrollmentIds: z.array(z.uuid()).min(1, "종료할 반을 선택해 주세요.").max(100).optional(),
  subjects: z.array(z.string().min(1).max(80)).min(1).max(20),
  effectiveDate: z.iso.date(), note: z.string().trim().max(1000),
}).superRefine((r, ctx) => {
  if (r.teacherIds.some(id => r.managerIds.includes(id)))
    ctx.addIssue({ code: "custom", message: "작성자·관리자를 서로 다르게 지정해 주세요." });
});
/**
 * 관리자 바로 처리(강사 작성 없이) 입력 — 원장 2026-10-23 *"관리자가 어느 학생에 대해 퇴원보고서 카드에서 '강사 작성 없이 바로 퇴원(수강종료)'
 * 가능하게"*. 사유는 다른 곳과 같은 세 칸(대분류 · 세부 · 메모 — `ReasonFields`, 서버는 `checkReasonInput`)이다.
 * 종료할 반은 0개일 수 있다(지금 다니는 반이 없는 학생 = 퇴원만). 처리는 DB `direct_withdrawal_report`(0453a)가 보고서 기록을 남기고
 * 승인된 보고서와 **같은 처리 함수**(`transition_withdrawal_report` apply)로 한다.
 */
export const directSchema = z.object({
  studentId: z.uuid(),
  enrollmentIds: z.array(z.uuid()).max(100),
  effectiveDate: z.iso.date(),
  reason: z.enum(Object.keys(REASON_LABEL) as [keyof typeof REASON_LABEL, ...Array<keyof typeof REASON_LABEL>], { error: "퇴원 사유를 골라 주세요." }),
  reasonDetail: z.string().max(80).optional(),
  memo: z.string().trim().max(5000, "메모는 5,000자 이내로 입력해 주세요."),
});
export type DirectRequest = z.infer<typeof directSchema>;
/**
 * 관리자 바로 처리 보고서인가 — DB가 `direct` 칸과 **작성자 = 승인 관리자 = 요청자**를 한 묶음으로 잠근다(0453a CHECK).
 * 일반 요청은 작성자와 관리자가 늘 다르다(요청 함수 · 옛 CHECK). 화면은 이 모양으로 읽는다 — 칸을 따로 읽지 않아 옛 스키마에서도 안 죽는다(#95).
 */
export function isDirectReport(r: Pick<WithdrawalReport, "teacher_id" | "manager_id" | "requested_by">) {
  return r.teacher_id === r.manager_id && r.manager_id === r.requested_by;
}
/**
 * 관리 도구 장부 정리(수강 없는 재원생 일괄 퇴원)가 남긴 바로 처리 보고서인가 — 바로 처리 · 사유 '기타' · 메모 = 장부 정리 메모.
 * 퇴원보고서 목록에서는 조용히 뺀다(원장 2026-10-15 *"장부 정리는 그냥 미출력되게"* — 퇴원관리와 같은 결 · 학생 기록·퇴원 상세엔 남는다).
 * 정상 보고서의 상세사유는 제출 기준(`MIN_DETAIL_LENGTH`) 이상이라 이 짧은 메모와 겹치지 않는다.
 */
export function isBookkeepingReport(r: Pick<ReportListRow, "teacher_id" | "manager_id" | "requested_by" | "body_reason" | "body_detail">) {
  return isDirectReport(r) && r.body_reason === "other" && (r.body_detail ?? "").trim() === CLEANUP_WITHDRAWAL_MEMO;
}
export function automaticExitKind(courses: { id: string }[], enrollmentIds: readonly string[]) {
  return courses.length > 0 && courses.every(c => enrollmentIds.includes(c.id)) ? "withdrawal" as const : "subject_end" as const;
}
export type CourseSnapshot = { id: string; classId: string; className: string; subject: string; teacherId: string | null; teacherName: string | null; startDate: string; endDate: string | null; onHold: boolean;
  /** 요청 창에서만 쓴다(저장된 보고서 스냅샷에는 없다) — '수업보고서 미발송' 반(0174a) · EiE 반(사업자가 달라 같은 영어로 묶지 않는다). */
  reportOptout?: boolean; eie?: boolean };
export type StudentSnapshot = { name: string; school: string | null; grade: string | null; enrolledAt: string | null; status: string; withdrawnAt: string | null; courses: CourseSnapshot[];
  /** 완료·취소된 보고서의 수강기간 칸 이력 — 처음 열 때 고정(원장 2026-10-30 '완료 시점 값으로 고정'). 없으면 지금 수강 기록으로 센다. */
  subjectHistory?: SubjectHistoryRow[] };
export type WithdrawalReport = {
  /** manager_id — 관리자 승인을 생략한 묶음(s2_0020)은 null · manager_ids = []. */
  id: string; tenant_id: string; student_id: string; requested_by: string; teacher_id: string; manager_id: string | null; director_id: string | null;
  enrollment_ids?: string[] | null;
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
  /** 목록 검색용 본문 글 칸(원장 2026-10-30 *"검색은 내용등 모든것을 검색가능하게"*) — 목록 조회만 싣는다. */
  body_student?: string | null; body_parent?: string | null; body_opinion?: string | null; body_attendance?: string | null; body_tuition?: string | null; body_arrears_note?: string | null;
};
export type StaffOption = { id: string; name: string; role: SystemRole; subjects: string[]; approvalSubjects?: string[] };
export type StudentOption = { id: string; name: string; school: string | null; grade: string | null; courses: CourseSnapshot[];
  /** 진행 중인 다른 퇴원보고서가 맡은 과목의 반(s2_0014 — 과목이 다르면 따로 요청한다) · 여기서는 고를 수 없고 처리 구분(퇴원/수강종료)만 센다. */
  busyCourses?: CourseSnapshot[] };
/**
 * 요청 이후 학생·수강이 그대로인가 — `subjects`를 주면 그 과목의 수강만 대조한다(과목 수강종료 묶음 · DB `withdrawal_report_scope`와 같은 규칙 s2_0014:
 * 다른 과목 보고서가 먼저 끝나 그 과목 수강이 닫혀도 이 보고서는 바뀐 것이 아니다). 퇴원 묶음은 학생 전체를 대조한다.
 * 🔑 반 이름(className)은 대조하지 않는다 — 반 이름만 바뀐(LE1→LE2) 보고서가 '변경됨'으로 막혔다(원장 2026-11-03 · DB `withdrawal_report_compare_key` s2_0020과 같은 규칙).
 */
export function snapshotMatches(a: StudentSnapshot, b: StudentSnapshot, subjects?: readonly string[]) {
  const key = (s: StudentSnapshot) => JSON.stringify([s.name, s.school, s.grade, s.enrolledAt, s.status, s.withdrawnAt,
    [...s.courses].filter(c => !subjects || subjects.includes(c.subject)).sort((x, y) => x.id.localeCompare(y.id)).map(c => [c.id, c.classId, c.subject, c.teacherId, c.teacherName, c.startDate, c.endDate, c.onHold])]);
  return key(a) === key(b);
}
export function canRequestReport(role: SystemRole) { return role === "master" || role === "admin" || role === "manager"; }
export function managerIds(r: Pick<WithdrawalReport, "manager_id" | "manager_ids">) { return r.manager_ids ?? (r.manager_id ? [r.manager_id] : []); }
export function directorIds(r: Pick<WithdrawalReport, "director_id" | "director_ids">) { return r.director_ids ?? (r.director_id ? [r.director_id] : []); }
/**
 * 관리자 승인을 생략한 보고서(원장 2026-11-03 — 작성 강사가 그 과목 관리자) — 승인 관리자 0명. 제출이 곧 관리자 승인이다(DB s2_0020).
 * 바로 처리 보고서는 관리자(처리한 사람)가 있어 해당 없다. ~~2026-10-30 원장을 관리자 칸에 넣던 모양~~은 더 만들지 않는다.
 */
export function managerStepSkipped(r: Pick<WithdrawalReport, "manager_id" | "manager_ids">) {
  return managerIds(r).length === 0;
}
/**
 * 데스크 환불 단계(원장 2026-11-03 *"환불요청시 퇴원보고서에 '데스크 환불 요청 승인 단계'도 같이 추가"*) — 보고서에서 만든 환불 요청서 한 장.
 * 환불완료일자(`completedDate`)가 들어가면 끝. 요청서를 지우면 단계에서 빠진다(DB `withdrawal_report_refund_pending`과 같은 판정).
 */
export type RefundStep = { documentId: string; deskId: string | null; deskName: string; completedDate: string | null };
/** 처리를 기다리게 하는 데스크 환불이 남았나 — 끝난·취소·재검토 보고서엔 기다릴 처리가 없다. */
export function refundWaiting(r: Pick<WithdrawalReport, "status">, refunds: readonly RefundStep[]) {
  return !["completed", "canceled", "blocked"].includes(r.status) && refunds.some(s => !s.completedDate);
}
const WITH_DESK: Partial<Record<ReportStatus, string>> = { manager_pending: "관리자 승인 요청", approved: "관리자 승인 완료" };
/**
 * 상태 칩 — 데스크 환불이 남았으면 원래 단계와 '데스크 환불 요청'을 함께(원장 2026-11-03 *"'관리자 승인 요청' '데스크 환불 요청' 같이 나타내줄것"*).
 * 모든 보고서가 승인돼 환불만 남은 묶음도 '관리자 승인 완료' · '데스크 환불 요청'으로 읽힌다.
 */
export function reportStatusChips(r: Pick<WithdrawalReport, "status">, refunds: readonly RefundStep[] = []): string[] {
  if (!refundWaiting(r, refunds)) return [REPORT_STATUS[r.status]];
  return [WITH_DESK[r.status] ?? REPORT_STATUS[r.status], "데스크 환불 요청"];
}
export function reportStatusLabel(r: Pick<WithdrawalReport, "status">, refunds: readonly RefundStep[] = []) {
  return reportStatusChips(r, refunds).join(" · ");
}
export function isParticipant(r: Pick<WithdrawalReport, "requested_by" | "teacher_id" | "manager_id" | "director_id" | "manager_ids" | "director_ids">, userId: string) {
  return [r.requested_by, r.teacher_id, ...managerIds(r), ...directorIds(r)].includes(userId);
}
/**
 * 원장 이상이면 남이 요청한 보고서도 취소한다(원장 2026-10-26 *"원장이상급 또는 퇴원보고서 요청자. 진행여부 상관없이"*) —
 * 처리 끝(completed) 전이면 작성·승인·처리 예약 어느 단계든. DB 처리 함수(0421a 'cancel')와 같은 축 = 원장 역할(운영자 계정도 원장 역할).
 * 강사뷰로 보는 중엔 원장 몫으로 치지 않는다.
 */
export function cancelsAsDirector(role: SystemRole, teacherView: boolean) { return role === "master" && !teacherView; }
/**
 * 보고서에서 데스크 환불을 요청(환불 승인)할 수 있나 — 원장 2026-11-03: 그 묶음의 관리자 · 요청자 · 관리자 승인을 생략한 보고서의 작성 강사 · 원장급.
 * (2026-10-29엔 원장만.) 취소된 보고서는 안 된다. 처리가 끝난 보고서는 된다(처리를 기다리게 하지 않는다 — 종전처럼).
 * 화면 토글(`LaterInvoices`)·데스크 담당자 목록(`getReport`)·서버(`approveWithdrawalRefund`)가 이 한 곳을 본다.
 */
export function canRequestRefund(r: Pick<WithdrawalReport, "status" | "requested_by" | "teacher_id" | "manager_id" | "manager_ids">, userId: string, writable: boolean, directorLevel = false) {
  if (!writable || r.status === "canceled") return false;
  return directorLevel || r.requested_by === userId || managerIds(r).includes(userId) || (managerStepSkipped(r) && r.teacher_id === userId);
}
export function reportCapabilities(r: WithdrawalReport, userId: string, writable: boolean, directorLevel = false) {
  const draft = r.status === "requested" || r.status === "revision";
  return {
    edit: writable && draft && r.teacher_id === userId,
    approve: writable && ((r.status === "manager_pending" && managerIds(r).includes(userId) && !r.manager_decisions?.[userId]) || (r.status === "director_pending" && directorIds(r).includes(userId) && !r.director_decisions?.[userId])),
    cancel: writable && (r.requested_by === userId || directorLevel) && !["completed", "canceled"].includes(r.status),
    refund: canRequestRefund(r, userId, writable, directorLevel),
  };
}
/** 퇴원 상세사유 제출 기준 글자 수 — DB 전이 함수 두 개(s2_0015)도 같은 값으로 거른다. 바꿀 땐 함께 바꾼다. */
export const MIN_DETAIL_LENGTH = 100;
export function submissionError(body: ReportBody): string | null {
  if (Array.from(body.detail.trim()).length < MIN_DETAIL_LENGTH) return `퇴원 상세사유를 ${MIN_DETAIL_LENGTH}자 이상 작성해 주세요.`;
  if (!body.studentConsultation.trim() || !body.parentConsultation.trim() || !body.teacherOpinion.trim())
    return "학생·학부모 상담 결과와 담임 의견을 작성해 주세요. 상담하지 못했다면 그 사유를 적어 주세요.";
  return null;
}
export function missingReportSchema(error: { code?: string; message?: string } | null) {
  return !!error && (["42P01", "PGRST205", "PGRST202"].includes(error.code ?? "") || /withdrawal_reports.*schema cache/i.test(error.message ?? ""));
}
