import {
  dateRangesOverlap,
  timeRangesOverlap,
  DAY_LABEL_KO,
} from "@/features/classes/overlap";
import {
  enrollmentAttendsOnDay,
  enrollmentOnHoldForStatus,
} from "@/features/enrollments/eligibility";
import { shiftDays } from "../../lib/week";
import type { MasterContext, MasterPlan, MasterIssue } from "./types";

/** Compare the resulting roster across subjects, respecting effective dates and split attendance. */
export function masterStudentConflicts(
  plan: MasterPlan,
  ctx: MasterContext,
): MasterIssue[] {
  const moved = new Set(plan.roster.moves.map((m) => m.enrollmentId));
  const roster = ctx.enrollments.filter((e) => !moved.has(e.id));
  for (const m of plan.roster.moves) {
    const old = ctx.enrollments.find((e) => e.id === m.enrollmentId)!;
    roster.push({
      ...old,
      classId: m.toClassId,
      startDate: plan.effectiveDate,
      endDate: null,
      isTransferred: false,
    });
  }
  for (const a of plan.roster.adds)
    roster.push({
      id: `add:${a.studentId}:${a.classId}`,
      studentId: a.studentId,
      classId: a.classId,
      startDate: plan.effectiveDate,
      endDate: null,
      isTransferred: false,
      attendanceDays: [],
      onHold: enrollmentOnHoldForStatus(
        ctx.students.find((s) => s.studentId === a.studentId)?.status,
      ),
    });
  const replaced = new Set(
    plan.report.planItems
      .filter((p) => p.action !== "keep")
      .map((p) => p.scheduleId),
  );
  const schedules = [
    ...ctx.schedules
      .filter((s) => !replaced.has(s.id))
      .map((s) => ({ ...s, changed: false })),
    ...plan.report.planItems
      .filter(
        (p) => (p.action === "create" || p.action === "update") && p.classId,
      )
      .map((p) => ({
        classId: p.classId!,
        className: p.className,
        day: p.day,
        startTime: p.startTime,
        endTime: p.endTime,
        validFrom: plan.effectiveDate,
        validTo:
          p.action === "keep"
            ? (ctx.schedules.find((s) => s.id === p.scheduleId)?.validTo ??
              null)
            : null,
        changed: p.action !== "keep",
      })),
  ];
  const byStudent = new Map<
    string,
    {
      classId: string;
      className: string;
      day: string;
      start: string;
      end: string;
      from: string;
      to: string | null;
      changed: boolean;
    }[]
  >();
  for (const e of roster) {
    if (e.onHold) continue;
    const gained =
      plan.roster.adds.some(
        (a) => a.studentId === e.studentId && a.classId === e.classId,
      ) || plan.roster.moves.some((m) => m.enrollmentId === e.id);
    for (const s of schedules) {
      if (
        s.classId !== e.classId ||
        !s.endTime ||
        !enrollmentAttendsOnDay(e.attendanceDays, s.day)
      )
        continue;
      const from = [e.startDate, s.validFrom, plan.effectiveDate]
        .sort()
        .at(-1)!;
      const ends = [
        e.endDate
          ? e.isTransferred
            ? shiftDays(e.endDate, -1)
            : e.endDate
          : null,
        s.validTo,
      ]
        .filter((v): v is string => !!v)
        .sort();
      const to = ends[0] ?? null;
      if (to && to < from) continue;
      const rows = byStudent.get(e.studentId) ?? [];
      rows.push({
        classId: s.classId,
        className: s.className,
        day: s.day,
        start: s.startTime,
        end: s.endTime,
        from,
        to,
        changed: s.changed || gained,
      });
      byStudent.set(e.studentId, rows);
    }
  }
  const issues = new Map<string, MasterIssue>();
  for (const [studentId, rows] of byStudent)
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!,
          b = rows[j]!;
        if (
          a.classId === b.classId ||
          a.day !== b.day ||
          !(a.changed || b.changed) ||
          !timeRangesOverlap(a.start, a.end, b.start, b.end) ||
          !dateRangesOverlap(a.from, a.to, b.from, b.to)
        )
          continue;
        const names = [a.className, b.className].sort();
        const key = `student-time:${studentId}:${a.day}:${names.join("|")}:${[a.start, b.start].sort().join("|")}`;
        issues.set(key, {
          key,
          severity: "confirm",
          target:
            ctx.students.find((s) => s.studentId === studentId)?.name ?? "학생",
          reason: `${DAY_LABEL_KO[a.day]} ${a.className} ${a.start}~${a.end}와 ${b.className} ${b.start}~${b.end} 수업이 겹칩니다.`,
          fix: "학생의 다른 과목 수업과 분리등원 요일을 확인하세요. LAB·JJ도 학생이 참석하는 시간으로 검사합니다.",
          href: `/students/${studentId}`,
        });
      }
  return [...issues.values()];
}
