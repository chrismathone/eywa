import {
  attendanceSchedules,
  attendanceTarget,
  slotsOn,
} from "./attendance-target";
import { axisDowOf } from "@/features/attendance/teacher-axis";
import { specialSlotLabel } from "../../lib/teacher-label";
import type { AttendanceMigration, MasterAttendance } from "./attendance-types";
import type { MasterContext, MasterPlan, MasterIssue } from "./types";
import { planWholeAbsences } from "./attendance-absence";

type Plan = Pick<
  MasterPlan,
  "report" | "roster" | "mappings" | "effectiveDate"
> & {
  /** 어느 수업이 어디로 갔는지 아는 호출자(연습본 적용)만 넘긴다. 시트 반영은 추정 규칙을 그대로 쓴다. */
  pinnedTimes?: ReadonlyMap<string, string>;
};
export const pinnedTimeKey = (classId: string, day: string | null, start: string | null) =>
  JSON.stringify([classId, day, start]);
const cellKey = (a: MasterAttendance) =>
  JSON.stringify([a.studentId, a.classId, a.date, a.startTime]);
export function planAttendanceMigration(
  plan: Plan,
  ctx: MasterContext,
): AttendanceMigration & { issues: MasterIssue[] } {
  const result: AttendanceMigration & { issues: MasterIssue[] } = {
    moves: [],
    retainedCells: 0,
    issues: [],
  };
  const { before, after } = attendanceSchedules(plan, ctx);
  result.moves = planWholeAbsences(plan, ctx, before, after);
  const regrouped = new Set(result.moves.flatMap((m) => m.ids));
  const cells = new Map<string, MasterAttendance[]>();
  for (const a of ctx.attendance) {
    if (
      regrouped.has(a.id) ||
      a.date < plan.effectiveDate ||
      !ctx.classes.some((c) => c.id === a.classId)
    )
      continue;
    cells.set(cellKey(a), [...(cells.get(cellKey(a)) ?? []), a]);
  }
  for (const [key, rows] of cells) {
    const a = rows[0]!;
    const moves = plan.roster.moves.filter((m) => {
      const e = ctx.enrollments.find((e) => e.id === m.enrollmentId);
      return e?.studentId === a.studentId && e.classId === a.classId;
    });
    const changed = plan.report.planItems.some(
      (p) =>
        p.classId === a.classId &&
        p.action !== "keep" &&
        p.day === axisDowOf(a.date) &&
        (a.startTime === null || p.startTime === a.startTime),
    );
    if (!moves.length && !changed) continue;
    const studentName =
      ctx.students.find((s) => s.studentId === a.studentId)?.name ?? "학생";
    const toClassId = moves[0]?.toClassId ?? a.classId;
    const oldSlots = slotsOn(before, a.classId, a.date);
    const newSlots = slotsOn(after, toClassId, a.date);
    const pinned = moves.length ? undefined : plan.pinnedTimes?.get(pinnedTimeKey(a.classId, axisDowOf(a.date), a.startTime));
    const pinnedSlots = newSlots.filter((s) => s.startTime === pinned);
    const target: ReturnType<typeof attendanceTarget> = pinned && pinnedSlots.length === 1
      ? { time: pinned, seatLabel: specialSlotLabel(pinnedSlots[0]!.label ?? "") }
      : attendanceTarget(oldSlots, newSlots, a.startTime);
    let reason =
      moves.length > 1
        ? "한 학생의 출결을 옮길 새 반이 여러 개입니다."
        : "error" in target
          ? target.error
          : null;
    const toTime = "time" in target ? target.time! : null;
    const newSeat = "seatLabel" in target ? target.seatLabel : undefined;
    const oldSeat = specialSlotLabel(oldSlots.find((s) => s.startTime === a.startTime)?.label ?? "");
    const seatChanged = newSeat !== undefined && (
      oldSeat !== newSeat || rows.some((r) => {
        const recordedSeat = specialSlotLabel(String(r.record.seat_label ?? ""));
        return (!!recordedSeat && recordedSeat !== newSeat) ||
          (r.record.recorded_via === "seat" && newSeat === null);
      })
    );
    const changes = toClassId !== a.classId || toTime !== a.startTime || seatChanged;
    if (
      !reason &&
      changes &&
      newSeat === undefined &&
      rows.some((r) => {
        const seat = specialSlotLabel(String(r.record.seat_label ?? ""));
        return (
          seat &&
          newSlots
            .filter((s) => toTime === null || s.startTime === toTime)
            .some((s) => specialSlotLabel(s.label ?? "") !== seat)
        );
      })
    )
      reason =
        "기록된 LAB·JJ 자리와 새 교시의 자리 구분이 다릅니다. 출결 귀속을 확인해 주세요.";
    if (!reason && !changes) {
      result.retainedCells++;
      continue;
    }
    if (
      !reason &&
      ctx.attendanceLinks.some(
        (l) =>
          l.studentId === a.studentId &&
          l.date === a.date &&
          [a.classId, toClassId].includes(l.classId),
      )
    )
      reason =
        "이 날짜에 연결된 수업보고서 또는 보강 예약이 있어 출결만 따로 옮길 수 없습니다.";
    if (
      !reason &&
      rows.some((r) => r.record.status === "makeup" || r.record.taught_by)
    )
      reason =
        "보강 출결 또는 대신 보강의 강사 귀속이 있습니다. 보강 반 변경에서 함께 옮겨 주세요.";
    if (
      !reason &&
      ctx.attendance.some(
        (v) =>
          !rows.some((r) => r.id === v.id) &&
          // 함께 다른 교시로 비켜나는 칸은 충돌이 아니다(한 교시씩 밀리는 시간표).
          !plan.pinnedTimes?.has(pinnedTimeKey(v.classId, axisDowOf(v.date), v.startTime)) &&
          v.studentId === a.studentId &&
          v.classId === toClassId &&
          v.date === a.date &&
          (v.startTime === toTime || v.startTime === null || toTime === null),
      )
    )
      reason =
        "새 반의 같은 날짜·교시에 출결이 이미 있습니다. 기존 기록을 덮어쓰거나 합치지 않습니다.";
    const toClassName =
      plan.mappings.find((m) => m.classId === toClassId)?.sheetName ??
      ctx.classes.find((c) => c.id === toClassId)?.className ??
      "새 반";
    const fromClassName =
      ctx.classes.find((c) => c.id === a.classId)?.className ?? "이전 반";
    if (reason) {
      result.issues.push({
        key: `attendance:${key}`,
        severity: "error",
        target: `${studentName} · ${a.date} ${fromClassName} ${a.startTime ?? "하루 전체"}`,
        reason,
        fix: "학생의 출결과 새 반 시간표를 확인·수정한 뒤 다시 검사해 주세요. 기록을 삭제해서 우회할 필요는 없습니다.",
        href: `/students/${a.studentId}`,
      });
      continue;
    }
    result.moves.push({
      ids: rows.map((r) => r.id),
      studentId: a.studentId,
      studentName,
      date: a.date,
      fromClassId: a.classId,
      fromClassName,
      fromTime: a.startTime,
      toClassId,
      toClassName,
      toTime,
      ...(seatChanged ? { seatChange: {
        from: oldSeat ?? rows.map((r) => specialSlotLabel(String(r.record.seat_label ?? ""))).find(Boolean) ?? "일반 수업",
        to: newSeat!,
      } } : {}),
    });
  }
  // Unrelated cells must never collapse. Uniform full-day absences were grouped explicitly above.
  const conflicts = result.moves.filter((m, i, all) =>
    all.some(
      (v, j) =>
        i !== j &&
        v.studentId === m.studentId &&
        v.toClassId === m.toClassId &&
        v.date === m.date &&
        (v.toTime === m.toTime || v.toTime === null || m.toTime === null),
    ),
  );
  for (const m of conflicts)
    result.issues.push({
      key: `attendance:collision:${m.ids[0]}`,
      severity: "error",
      target: `${m.studentName} · ${m.date}`,
      reason:
        "여러 출결 교시가 새 반의 같은 칸에 연결되어 시수가 합쳐질 수 있습니다.",
      fix: "원본 교시와 새 반의 교시 배치를 확인해 주세요.",
      href: `/students/${m.studentId}`,
    });
  result.moves = result.moves.filter((m) => !conflicts.includes(m));
  if (result.moves.length)
    result.issues.push({
      key: "attendance-migration",
      severity: "confirm",
      target: `새 반·교시로 출결 ${result.moves.length}칸 자동 이관`,
      reason:
        "반이동·시간표 변경과 함께 적용일 이후 출결을 새 반·교시로 옮깁니다. 전교시가 같은 사유로 미리 결석 처리된 날은 새 교시 수에 맞춰 결석을 재배치합니다. 상태·시수·메모·입력자·원본 기록은 보존합니다.",
      fix: "아래 ‘기존 출결 이관’에서 학생별 이전 반·교시와 변경된 반·교시를 확인해 주세요.",
    });
  return result;
}
