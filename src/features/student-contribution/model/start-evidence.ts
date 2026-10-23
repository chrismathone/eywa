import type { StartEvidence } from "@/features/dashboard/overview/coverage-rules";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import type { SnapshotAttendance } from "@/features/teacher-portfolio/model/types";
import type { CoreSources } from "../server/source-types";
import type { BillingMonth } from "./billing";

export function referralEvidence(core: CoreSources, billing: readonly BillingMonth[], attendance: readonly SnapshotAttendance[], canonical: (id: string) => string) {
  const subjectOf = new Map(core.classes.map((c) => [c.id, c.subject]));
  const result = new Map<string, StartEvidence>();
  const get = (subject: string) => {
    if (!result.has(subject)) result.set(subject, { billMonths: new Map(), attendedOn: new Map(), classSpans: new Map() });
    return result.get(subject)!;
  };
  function push<T>(map: ReadonlyMap<string, readonly T[]>, student: string, value: T) {
    const mutable = map as Map<string, T[]>;
    mutable.set(student, [...(mutable.get(student) ?? []), value]);
  }
  for (const b of billing) if (b.seed.active) for (const subject of b.seed.subjects) push(get(subject).billMonths, b.studentId, b.month);
  for (const a of effectiveAttendanceRecords(attendance)) {
    const subject = subjectOf.get(a.class_id);
    if (subject && ["present", "late", "early_leave", "makeup"].includes(a.status)) push(get(subject).attendedOn, canonical(a.student_id), a.session_date);
  }
  for (const e of core.enrollments) {
    const subject = subjectOf.get(e.class_id);
    if (subject && !e.on_hold) push(get(subject).classSpans, canonical(e.student_id), { start: e.start_date, end: enrollmentLastDate(e.end_date, e.is_transferred) });
  }
  return (_student: string, subject: string) => get(subject);
}
