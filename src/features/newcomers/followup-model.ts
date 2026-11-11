import { z } from "zod";
import { ONBOARDING_ITEMS, dueDateOf, statusOf } from "./onboarding-items";
import type { NewcomerRow } from "./server/queries";

export const FOLLOWUP_STAGES = { d7: "첫 적응", d30: "30일", d60: "60일", d90: "90일" } as const;
export const CONDITIONS = { good: "잘 적응 중", watch: "관찰 필요", help: "지원 필요" } as const;
export type Person = { id: string; name: string };
export type Homeroom = Person & { subject: string; upcoming: boolean };
export type SubjectManager = { subject: string; manager: Person | null; defaultManager: Person | null; version: number; source: "default" | "manual" | "legacy" | "unassigned" };
export type ManagerAssignment = { student_id: string; subject: string; manager_id: string | null; mode: "default" | "manual"; version: number };
export type ManagerDefault = { subject: string; manager_id: string };
export function resolveSubjectManager(subject: string, assignment: ManagerAssignment | undefined, defaults: ManagerDefault[], people: Person[], legacy?: {manager_id: string | null}): SubjectManager {
  const person = (id: string | null | undefined) => people.find(p => p.id === id) ?? null;
  const defaultManager = person(defaults.find(d => d.subject === subject)?.manager_id);
  const source = assignment?.mode === "manual" ? "manual" : assignment?.mode === "default" ? "default" : legacy?.manager_id ? "legacy" : defaultManager ? "default" : "unassigned";
  return {subject, defaultManager, version:assignment?.version ?? 0, source,
    manager: source === "manual" ? person(assignment?.manager_id) : source === "legacy" ? person(legacy?.manager_id) : defaultManager};
}
export const managersOf = (s: FollowupStudent) => [...new Map(s.managers.flatMap(a => a.manager ? [a.manager] : []).map(p => [p.id,p])).values()];
export const hasUnassignedSubject = (s: FollowupStudent) => !s.managers.length || s.managers.some(a => !a.manager);
export const needsEnrollmentLink = (s: FollowupStudent) => !s.subjects.some(row => !!row.subject);
export function subjectStudent(s: FollowupStudent, subject: string | null): FollowupStudent { return {...s, row:s.subjects.find(r=>r.subject===subject)??s.row, subjects:s.subjects.filter(r=>r.subject===subject), managers:s.managers.filter(a=>a.subject===(subject??""))}; }
export type FollowupReport = {
  id: string; student_id: string; subject: string; stage: keyof typeof FOLLOWUP_STAGES;
  author_id: string; authorName: string; condition: keyof typeof CONDITIONS; summary: string;
  next_action: string; next_due: string | null; created_at: string; response: string;
  review_state: "pending" | "confirmed" | "revision"; review_note: string; reviewed_by: string | null; reviewerName: string | null; reviewed_at: string | null;
  followup_result: string; followup_at: string | null; followup_by: string | null; followupName: string | null; version: number;
};
export type CheckEvidence = { doneBy: string | null; doneByName: string | null; memo: string | null; consultationId: string | null };
export type FollowupStudent = {
  row: NewcomerRow; subjects: NewcomerRow[]; homerooms: Homeroom[];
  managers: SubjectManager[]; reports: FollowupReport[];
  evidence: Record<string, CheckEvidence>; openPromises: number | null;
};
export type FollowupView = {
  today: string; students: FollowupStudent[]; staff: Person[]; actorId: string;
  defaults?: {subject:string;manager:Person|null}[];
  canManage: boolean; canReport: boolean; error: string | null; checksKnown: boolean;
  /** '전체 완료 체크표' 쓰기 — 정착 관리 자료 조회가 실패해도(canManage가 꺼져도) 종전 체크표는 잠그지 않는다. */
  canWriteChecks: boolean;
};
export const reportSchema = z.object({
  id: z.uuid(), studentId: z.uuid(), subject: z.string().trim().min(1).max(60), stage: z.enum(["d7", "d30", "d60", "d90"]),
  condition: z.enum(["good", "watch", "help"]), summary: z.string().trim().min(5).max(2000),
  nextAction: z.string().trim().max(1000), nextDue: z.iso.date().nullable(),
}).strict().refine(v => !!v.nextAction === !!v.nextDue, "후속 조치와 기한을 함께 입력해 주세요");
export const assignmentSchema = z.object({ studentId: z.uuid(), subject: z.string().regex(/^$|^[a-z][a-z0-9_]{0,31}$/), mode:z.enum(["default","manual"]), managerId: z.uuid().nullable(), version: z.number().int().min(0) }).strict().refine(v=>v.mode!=="default"||v.managerId===null,"기본 담당자는 과목 설정에서 적용됩니다");
export const reviewSchema = z.object({ id: z.uuid(), studentId: z.uuid(), version: z.number().int().positive(),
  operation: z.enum(["confirmed", "revision", "resolve", "respond"]), note: z.string().trim().min(2).max(1500) }).strict();

export function callSummary(student: FollowupStudent, key: string, today: string, known = true) {
  const item = ONBOARDING_ITEMS.find(i => i.key === key)!;
  const states = student.subjects.map(row => statusOf(item, row, row.checks[key], today));
  const done = states.filter(s => s === "done").length;
  const state = !known || !states.length ? "unknown" : done === states.length ? "done" : item.optional ? "optional"
    : states.includes("overdue") ? "overdue" : states.includes("due") ? "due" : states.includes("pending") ? "pending" : states.every(s => s === "waived") ? "waived" : "upcoming";
  const dates = student.subjects.flatMap(row => row.checks[key] ? [row.checks[key]!] : []);
  const actors = [...new Set(student.subjects.flatMap(row => student.evidence[`${row.subject ?? ""}|${key}`]?.doneByName ?? []))];
  return { state, done, total: states.length, due: dueDateOf(item, student.row), doneOn: dates.sort().at(-1) ?? null, actors,
    label: state === "unknown" ? "확인 필요" : state === "done" ? "완료" : done ? `${done}/${states.length}과목 완료` : state === "overdue" ? "기한 경과" : state === "due" ? "곧 연락" : state === "pending" ? "날짜 미정" : state === "waived" ? "이전 항목" : state === "optional" ? "필요시 점검" : "예정" };
}
export const currentStage = (elapsed: number): keyof typeof FOLLOWUP_STAGES => elapsed <= 7 ? "d7" : elapsed <= 30 ? "d30" : elapsed <= 60 ? "d60" : "d90";
export const followupOpen = (report: FollowupReport) => !!report.next_action && !report.followup_at;
export const needsReview = (report: FollowupReport) => report.review_state !== "confirmed";
export function studentAttention(s: FollowupStudent, known: boolean) {
  return hasUnassignedSubject(s) || !s.homerooms.length || s.reports.some(r => needsReview(r) || followupOpen(r)) || (known && s.subjects.some(row => row.progress.overdue > 0));
}
