import { nextClosedClassName } from "@/features/classes/closed-name";
import { shiftDays } from "../../lib/week";
import type { MasterContext, MasterPlan } from "./types";

export type MasterClassTerm = {
  classId: string;
  fromName: string;
  toName: string;
  closedAt: string;
  students: { id: string; name: string }[];
};
export function planClassTerms(
  ids: string[],
  date: string,
  ctx: MasterContext,
  moves: MasterPlan["roster"]["moves"],
): MasterClassTerm[] {
  const closedAt = shiftDays(date, -1);
  const names = new Map(ctx.classes.map((c) => [c.id, c.className]));
  const moved = new Set(moves.map((m) => m.enrollmentId));
  return [...new Set(ids)].sort().flatMap((classId) => {
    const c = ctx.classes.find((c) => c.id === classId);
    if (!c) return [];
    const toName = nextClosedClassName(
      c.className,
      closedAt,
      ctx.classes
        .filter((v) => v.subject === c.subject && v.id !== classId)
        .map((v) => names.get(v.id)!),
    );
    names.set(classId, toName);
    const students = [
      ...new Set(
        ctx.enrollments
          .filter((e) => e.classId === classId && !e.endDate && !moved.has(e.id))
          .map((e) => e.studentId),
      ),
    ].map((id) => ({ id, name: ctx.students.find((s) => s.studentId === id)?.name ?? "학생" }));
    return [{ classId, fromName: c.className, toName, closedAt, students }];
  });
}
