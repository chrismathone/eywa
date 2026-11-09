import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import type { AttendanceTarget, ContributionAttendance } from "./participation";
import type { BillingSeed } from "./billing";
import type { ParentEventSources } from "./parent-events/facts";

export type RankingGrade = { id: string; student_id: string; subject: string; exam_slot: string | null; exam_name: string;
  score: string | number | null; max_score: string | number | null; taken_on: string; no_exam: boolean | null; school_year?: number | null };
export type RankingFacts = {
  version: 1; asOf: string; activityFrom: string;
  billing: { months: number; subjectMonths: number; concurrentMonths: number; paid: number; extraSubjectPaid: number; concurrentPaid: number; unknownMonths: number; first: string | null; last: string | null };
  attendance: { scheduled: number; recorded: number; present: number; late: number; absent: number; early: number; rate: number | null };
  seminar: { attended: number | null; registeredOnly: number; from: string | null; pending: boolean };
  school: { current: number | null; improvement: number | null; subjects: number; pairs: number; latest: string | null };
};
const round = (n: number) => Math.round(n * 100) / 100;
const mean = (v: number[]) => v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null;
export function schoolRankingFacts(rows: readonly RankingGrade[]): RankingFacts["school"] {
  const groups = new Map<string, { day: string; score: number }[]>();
  for (const g of rows) {
    const slot = /듣기/.test(g.exam_name) || g.exam_slot === "listening" ? "listening"
      : /중간/.test(g.exam_name) || g.exam_slot === "midterm" ? "midterm"
      : /기말/.test(g.exam_name) || g.exam_slot === "final" ? "final" : g.exam_slot === "school" || /내신/.test(g.exam_name) ? "school" : null;
    if (!slot || g.no_exam || g.score === null || g.max_score === null || !g.subject) continue;
    const score = Number(g.score), max = Number(g.max_score);
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0 || score < 0 || score > max) continue;
    const key = `${g.subject}:${slot}:${g.school_year ?? g.taken_on.slice(0, 4)}`;
    const list = groups.get(key) ?? []; list.push({ day: g.taken_on, score: score / max * 100 }); groups.set(key, list);
  }
  const latestBySubject = new Map<string, { day: string; score: number }>(), improvements: number[] = [];
  for (const [key, list] of groups) {
    // Conflicting duplicate marks for the same examination day are not silently ranked.
    const days = [...new Set(list.map(r => r.day))].sort().reverse();
    const unique = days.flatMap(day => { const scores = [...new Set(list.filter(r => r.day === day).map(r => r.score))]; return scores.length === 1 ? [{ day, score: scores[0]! }] : []; });
    if (!unique.length) continue;
    const subject = key.split(":")[0]!, latest = unique[0]!, before = latestBySubject.get(subject);
    if (!before || latest.day > before.day) latestBySubject.set(subject, latest);
    // Generic school marks cannot establish a comparable exam type.
    if (!key.includes(":school:") && unique.length >= 2) improvements.push(latest.score - unique[1]!.score);
  }
  const current = [...latestBySubject.values()];
  return { current: mean(current.map(r => r.score)), improvement: mean(improvements), subjects: current.length, pairs: improvements.length,
    latest: current.map(r => r.day).sort().at(-1) ?? null };
}

export function attendanceRankingFacts(targets: readonly AttendanceTarget[], rows: readonly ContributionAttendance[], asOf: string): RankingFacts["attendance"] {
  const key = (r: AttendanceTarget) => `${r.class_id}:${r.session_date}:${r.slot_start ?? ""}`;
  const unique = [...new Map(targets.filter(t => t.session_date < asOf).map(t => [key(t), t])).values()];
  const byDay = new Map<string, ContributionAttendance[]>();
  for (const r of effectiveAttendanceRecords(rows).filter(r => !r.seat_label)) {
    const day = `${r.class_id}:${r.session_date}`, list = byDay.get(day) ?? []; list.push(r); byDay.set(day, list);
  }
  const dayCounts = new Map<string, number>();
  unique.forEach(t => { const day = `${t.class_id}:${t.session_date}`; dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1); });
  const out = { scheduled: unique.length, recorded: 0, present: 0, late: 0, absent: 0, early: 0, rate: null as number | null };
  for (const t of unique) {
    const day = `${t.class_id}:${t.session_date}`, records = byDay.get(day) ?? [];
    const matched = records.filter(r => r.slot_start === t.slot_start || ((!r.slot_start || !t.slot_start) && dayCounts.get(day) === 1));
    if (matched.length !== 1) continue;
    const status = matched[0]!.status;
    if (!["present", "late", "absent", "early_leave"].includes(status)) continue;
    out.recorded++;
    if (status === "present") out.present++;
    if (status === "late") out.late++;
    if (status === "absent") out.absent++;
    if (status === "early_leave") out.early++;
  }
  // Late / early leave receive half credit. Missing scheduled marks remain unknown.
  if (out.recorded) out.rate = round((out.present + (out.late + out.early) * 0.5) / out.recorded * 100);
  return out;
}
export function buildRankingFacts(input: { studentId: string; asOf: string; billing: readonly BillingSeed[];
  targets: readonly AttendanceTarget[]; attendance: readonly ContributionAttendance[]; grades: readonly RankingGrade[];
  events: ParentEventSources; canonical: (id: string) => string }): RankingFacts {
  const months = input.billing.filter(b => b.studentId === input.studentId && b.month <= input.asOf.slice(0, 7));
  const active = months.filter(b => b.active);
  const billing: RankingFacts["billing"] = { months: active.length, subjectMonths: 0, concurrentMonths: 0, paid: 0, extraSubjectPaid: 0, concurrentPaid: 0,
    unknownMonths: months.filter(b => b.unknownSubjects > 0).length, first: active.map(b => b.month).sort()[0] ?? null, last: active.map(b => b.month).sort().at(-1) ?? null };
  for (const b of months) {
    const subjects = new Set(b.subjects).size;
    billing.paid += b.tuitionWon;
    billing.extraSubjectPaid += b.tuitionWon * Math.max(0, subjects - 1);
    if (subjects >= 2) billing.concurrentPaid += b.tuitionWon;
    if (b.active) { billing.subjectMonths += subjects; if (subjects >= 2) billing.concurrentMonths++; }
  }
  const ownEvents = input.events.records.filter(r => input.canonical(r.studentId) === input.studentId && r.eventDate <= input.asOf);
  const attended = new Set(ownEvents.filter(r => r.attendanceBasis === "explicit_attendance").map(r => r.eventId));
  const registered = new Set(ownEvents.filter(r => !attended.has(r.eventId)).map(r => r.eventId));
  return { version: 1, asOf: input.asOf, activityFrom: "2026-01-01", billing,
    attendance: attendanceRankingFacts(input.targets, input.attendance, input.asOf),
    seminar: { attended: input.events.ready ? attended.size : null, registeredOnly: registered.size, from: input.events.coverageFrom ?? null,
      pending: !input.events.ready || !!input.events.pendingRows || registered.size > 0 },
    school: schoolRankingFacts(input.grades),
  };
}
