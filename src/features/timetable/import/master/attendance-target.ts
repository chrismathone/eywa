import { axisDowOf } from "@/features/attendance/teacher-axis";
import { specialSlotLabel } from "../../lib/teacher-label";
import type { MasterContext, MasterPlan } from "./types";

type Plan = Pick<MasterPlan, "report" | "effectiveDate">;
export type AttendanceSlot = {
  classId: string;
  day: string;
  startTime: string;
  endTime: string | null;
  teacherId: string | null;
  label: string | null;
  validFrom: string;
  validTo: string | null;
};
export function attendanceSchedules(plan: Plan, ctx: MasterContext) {
  const before: AttendanceSlot[] = ctx.schedules.map((s) => ({
    ...s,
    label: s.slotTeacherLabel,
  }));
  const replaced = new Set(
    plan.report.planItems
      .filter((p) => p.action !== "keep")
      .map((p) => p.scheduleId),
  );
  const after: AttendanceSlot[] = [
    ...ctx.schedules
      .filter((s) => !replaced.has(s.id))
      .map((s) => ({ ...s, label: s.slotTeacherLabel })),
    ...plan.report.planItems
      .filter(
        (p) => (p.action === "create" || p.action === "update") && p.classId,
      )
      .map((p) => ({
        classId: p.classId!,
        day: p.day,
        startTime: p.startTime,
        endTime: p.endTime,
        teacherId: p.teacherId ?? null,
        label: p.teacherNames[0] ?? null,
        validFrom: plan.effectiveDate,
        validTo: null,
      })),
  ];
  return { before, after };
}
export function slotsOn(
  slots: AttendanceSlot[],
  classId: string,
  date: string,
) {
  const day = axisDowOf(date);
  const found = slots.filter(
    (s) =>
      s.classId === classId &&
      s.day === day &&
      s.validFrom <= date &&
      (!s.validTo || s.validTo >= date),
  );
  return [
    ...new Map(
      found.map((s) => [
        JSON.stringify([
          s.startTime,
          s.endTime,
          s.teacherId,
          specialSlotLabel(s.label ?? ""),
        ]),
        s,
      ]),
    ).values(),
  ];
}
/** Exact time first. A shifted period needs a unique teacher/seat or a one-period day. No ordinal guess. */
export function attendanceTarget(
  before: AttendanceSlot[],
  after: AttendanceSlot[],
  start: string | null,
) {
  if (!after.length)
    return { error: "새 반에 해당 날짜의 수업 배치가 없습니다." };
  if (start === null) return { time: null };
  const exact = after.filter((s) => s.startTime === start);
  if (exact.length > 1)
    return { error: "새 반의 같은 시각에 서로 다른 수업 배치가 있습니다." };
  const old = before.filter((s) => s.startTime === start);
  if (old.length > 1)
    return { error: "기존 교시에 서로 다른 수업 배치가 있어 출결 귀속을 확정하지 못했습니다." };
  let target = exact[0];
  if (!target && old.length === 1) {
    const source = old[0]!;
    const seat = specialSlotLabel(source.label ?? "");
    const sameTeacher = after.filter((s) =>
      seat
        ? specialSlotLabel(s.label ?? "") === seat
        : !!source.teacherId && s.teacherId === source.teacherId,
    );
    if (sameTeacher.length === 1) target = sameTeacher[0];
    else if (before.length === 1 && after.length === 1) target = after[0];
  }
  if (!target)
    return {
      error: "기존 출결 교시에 대응하는 새 교시를 하나로 확정하지 못했습니다.",
    };
  return { time: target.startTime, seatLabel: specialSlotLabel(target.label ?? "") };
}
