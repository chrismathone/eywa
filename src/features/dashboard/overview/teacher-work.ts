export type WorkClass = { id: string; teacherId: string | null; teacherName: string; subject: string };
export type WorkReport = { id: string; classId: string; studentId: string; date: string; status: string | null; videoHomework: boolean };
export type WorkOutcome = { classId: string; studentId: string; date: string; status: string; observedAt: string };
export type TeacherWorkRow = {
  teacherId: string | null; teacherName: string; subject: string; classIds: string[];
  reports: number; sent: number; pending: number; failed: number; videoMissing: number;
};
export type TeacherWork = { reportFrom: string; videoFrom: string; to: string; videoCheckedAt: string | null; rows: TeacherWorkRow[] };

/** 현재 담당 반 기준. 동명이인은 ID로, 복수 과목 강사는 과목별로 분리한다. */
export function teacherWork(classes: readonly WorkClass[], reports: readonly WorkReport[], outcomes: readonly WorkOutcome[], range: Pick<TeacherWork, "reportFrom" | "videoFrom" | "to">): TeacherWork {
  const rows = new Map<string, TeacherWorkRow>();
  const byClass = new Map<string, TeacherWorkRow>();
  for (const cls of classes) {
    const key = `${cls.teacherId ?? "unassigned"}:${cls.subject}`;
    let row = rows.get(key);
    if (!row) { row = { teacherId: cls.teacherId, teacherName: cls.teacherName, subject: cls.subject, classIds: [], reports: 0, sent: 0, pending: 0, failed: 0, videoMissing: 0 }; rows.set(key, row); }
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
    if (rep.videoHomework && rep.date >= range.videoFrom) assignments.add(key);
    if (rep.date < range.reportFrom) continue;
    row.reports++;
    if (rep.status === "success") row.sent++;
    else if (["failed", "too_old", "name_conflict", "blocked_shared", "recall_failed"].includes(rep.status ?? "")) row.failed++;
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
  }
  return { ...range, videoCheckedAt, rows: [...rows.values()].sort((a, b) => b.failed + b.pending + b.videoMissing - a.failed - a.pending - a.videoMissing || a.teacherName.localeCompare(b.teacherName, "ko") || a.subject.localeCompare(b.subject)) };
}
