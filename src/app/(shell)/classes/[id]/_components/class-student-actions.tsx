import type { ClassStudentRow } from "@/features/classes/server/queries";
import type { ScheduledChange } from "@/features/enrollments/scheduled-changes";
import { EndEnrollmentAction } from "@/features/enrollments/components/end-enrollment-action";
import { CancelAssignmentButton } from "@/features/enrollments/components/cancel-assignment-button";
import { ScheduledChangeActions } from "@/components/scheduled-change-actions";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

/** Direct status, future assignment cancellation, and scheduled transfers have separate gates. */
export function ClassStudentActions({ student: s, className, today, permissions, scheduled, lang }: {
  student: ClassStudentRow;
  className: string;
  today: string;
  permissions: { basic: boolean; status: boolean; schedule: boolean };
  scheduled?: ScheduledChange;
  lang: SheetLang;
}) {
  if (s.phase === "upcoming") {
    if (!permissions.basic) return null;
    if (permissions.schedule && scheduled) return <ScheduledChangeActions change={scheduled} today={today} />;
    if (s.isTransferredIn || s.isTransferred) return <span className="text-text-dim text-xs">{sheetT(lang, "sched.moveReserved")}</span>;
    return <CancelAssignmentButton enrollmentId={s.enrollmentId} className={className} startDate={s.enrolledAt} studentName={s.name} />;
  }
  return permissions.status ? <EndEnrollmentAction enrollmentId={s.enrollmentId} studentId={s.studentId}
    studentName={s.name} className={className} currentEndDate={s.endDate} startDate={s.enrolledAt} today={today} /> : null;
}
