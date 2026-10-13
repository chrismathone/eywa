import { isTestClass, type WorkObligation } from "./work-targets";

export type WorkClass = { id: string; name?: string; teacherId: string | null; teacherName: string; subject: string; reportSource?: "lesson" | "classnote" | "none" };
export type WorkReport = { id: string; classId: string; studentId: string; date: string; coversDate?: string | null; status: string | null; videoHomework: boolean };
export type WorkOutcome = { classId: string; studentId: string; date: string; status: string; observedAt: string };
export type TeacherWorkRow = {
  teacherId: string | null; teacherName: string; subject: string; classIds: string[];
  reports: number; reportTarget: number; sent: number; pending: number; failed: number; videoMissing: number;
  videoAssigned: number; videoSubmitted: number; reportSource: "lesson" | "classnote" | "none";
};
export type TeacherWork = { reportFrom: string; videoFrom: string; to: string; videoCheckedAt: string | null; rows: TeacherWorkRow[] };

/** 현재 담당 반 기준. 동명이인은 ID로, 복수 과목 강사는 과목별로 분리한다. */
/**
 * `extraVideoAssignments` = 보고서 없이 따로 낸 영상 숙제(video-homework `extra-issues.ts`) — 영상 제출 현황과 같은 숙제 축이라 낸 숙제 수에 더한다
 * (같은 날 보고서에도 켜져 있으면 한 번만 · 보고서 수·발송 집계에는 들어가지 않는다).
 */
export function teacherWork(classes: readonly WorkClass[], reports: readonly WorkReport[], outcomes: readonly WorkOutcome[], range: Pick<TeacherWork, "reportFrom" | "videoFrom" | "to">, obligations?: readonly WorkObligation[],
  extraVideoAssignments: readonly Pick<WorkReport, "classId" | "studentId" | "date">[] = []): TeacherWork {
  const rows = new Map<string, TeacherWorkRow>();
  const byClass = new Map<string, TeacherWorkRow>();
  for (const cls of classes) {
    if (isTestClass(cls.name ?? "")) continue;
    const key = `${cls.teacherId ?? "unassigned"}:${cls.subject}`;
    let row = rows.get(key);
    if (!row) { row = { teacherId: cls.teacherId, teacherName: cls.teacherName, subject: cls.subject, classIds: [], reports: 0, reportTarget: 0, sent: 0, pending: 0, failed: 0, videoMissing: 0, videoAssigned: 0, videoSubmitted: 0, reportSource: cls.reportSource ?? "lesson" }; rows.set(key, row); }
    if (!row.classIds.includes(cls.id)) row.classIds.push(cls.id);
    byClass.set(cls.id, row);
  }
  const assignments = new Set<string>();
  const seen = new Set<string>();
  const keyOf = (r: { classId: string; studentId: string; date: string }) => `${r.classId}:${r.studentId}:${r.date}`;
  for (const rep of reports) {
    const row = byClass.get(rep.classId);
    if (!row || rep.date > range.to) continue;
    const key = keyOf(rep);
    if (seen.has(key)) continue;
    seen.add(key);
    if (rep.videoHomework && rep.date >= range.videoFrom) { assignments.add(key); row.videoAssigned++; }
    if (obligations) continue;
    if (rep.date < range.reportFrom) continue;
    row.reports++;
    row.reportTarget++;
    if (rep.status === "success") row.sent++;
    else if (["failed", "too_old", "name_conflict", "blocked_shared", "recall_failed"].includes(rep.status ?? "")) row.failed++;
    else row.pending++;
  }
  for (const extra of extraVideoAssignments) {
    const row = byClass.get(extra.classId);
    const key = keyOf(extra);
    if (!row || extra.date > range.to || extra.date < range.videoFrom || assignments.has(key)) continue;
    assignments.add(key);
    row.videoAssigned++;
  }
  for (const obligation of obligations ?? []) {
    const row = byClass.get(obligation.classId);
    if (!row || obligation.date < range.reportFrom || obligation.date > range.to) continue;
    row.reportTarget++;
    if (obligation.written) row.reports++;
    if (obligation.status === "success") row.sent++;
    else if (["failed", "too_old", "name_conflict", "blocked_shared", "recall_failed"].includes(obligation.status ?? "")) row.failed++;
    else row.pending++;
  }
  const counted = new Set<string>();
  let videoCheckedAt: string | null = null;
  for (const outcome of outcomes) {
    const row = byClass.get(outcome.classId);
    const key = keyOf(outcome);
    if (!row || !assignments.has(key) || counted.has(key)) continue;
    counted.add(key);
    if (!videoCheckedAt || outcome.observedAt < videoCheckedAt) videoCheckedAt = outcome.observedAt;
    if (outcome.status === "missing") row.videoMissing++;
    if (outcome.status === "submitted") row.videoSubmitted++;
  }
  return { ...range, videoCheckedAt, rows: [...rows.values()].sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko") || a.subject.localeCompare(b.subject) || (a.teacherId ?? "").localeCompare(b.teacherId ?? "")) };
}
