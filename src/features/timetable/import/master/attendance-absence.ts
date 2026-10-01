import type { AttendanceMove, MasterAttendance } from "./attendance-types";
import { attendanceTarget, slotsOn, type AttendanceSlot } from "./attendance-target";
import type { MasterContext, MasterPlan } from "./types";

const dayKey = (a: MasterAttendance) => JSON.stringify([a.studentId, a.classId, a.date]);
const identityFields = new Set([
  "id",
  "class_id",
  "student_id",
  "session_date",
  "slot_start",
  "recorded_at",
  "supersedes_id",
]);
// Even unknown payload fields must agree: collapsing different notes/provenance is not safe.
const payload = (a: MasterAttendance) =>
  JSON.stringify(
    Object.entries(a.record)
      .filter(([k]) => !identityFields.has(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
function isPreEnteredAbsence(a: MasterAttendance, cutoff: number) {
  const r = a.record;
  return (
    r.status === "absent" &&
    (r.session_units == null || r.session_units === 0) &&
    !r.seat_label &&
    !r.taught_by &&
    !r.salary_tier &&
    !r.homework_done &&
    !r.homework_required &&
    Date.parse(String(r.recorded_at)) < cutoff
  );
}

/** Repartition a uniform, complete pre-entered absence without creating/deleting facts.
 * English stays per-period. Surplus identical rows remain as history in a destination cell;
 * every original ID/anchor is saved by attendanceBackups and restored independently on cancel.
 * More destination periods require new facts, so this exception deliberately does not infer them.
 */
export function planWholeAbsences(
  plan: Pick<MasterPlan, "effectiveDate" | "roster" | "mappings">,
  ctx: MasterContext,
  before: AttendanceSlot[],
  after: AttendanceSlot[],
): AttendanceMove[] {
  const days = new Map<string, MasterAttendance[]>();
  for (const a of ctx.attendance) {
    if (a.date < plan.effectiveDate) continue;
    const key = dayKey(a);
    const rows = days.get(key) ?? [];
    rows.push(a);
    days.set(key, rows);
  }
  const result: AttendanceMove[] = [];
  for (const rows of days.values()) {
    const a = rows[0]!;
    const moves = plan.roster.moves.filter((m) => {
      const e = ctx.enrollments.find((e) => e.id === m.enrollmentId);
      return e?.studentId === a.studentId && e.classId === a.classId;
    });
    if (moves.length !== 1 || moves[0]!.toClassId === a.classId) continue;
    const toClassId = moves[0]!.toClassId;
    const oldSlots = slotsOn(before, a.classId, a.date);
    const newSlots = slotsOn(after, toClassId, a.date);
    const fromTimes = oldSlots.map((s) => s.startTime).sort();
    const toTimes = newSlots.map((s) => s.startTime).sort();
    if (
      !toTimes.length ||
      fromTimes.length < toTimes.length ||
      new Set(fromTimes).size !== fromTimes.length ||
      new Set(toTimes).size !== toTimes.length ||
      rows.some((r) => r.startTime === null || !fromTimes.includes(r.startTime)) ||
      fromTimes.some((t) => !rows.some((r) => r.startTime === t))
    )
      continue;
    const cutoff = Date.parse(`${a.date}T${[...fromTimes, ...toTimes].sort()[0]}:00+09:00`);
    const originals = new Map(rows.map((r) => [r.id, r]));
    if (
      !rows.every(
        (r) =>
          isPreEnteredAbsence(r, cutoff) &&
          payload(r) === payload(a) &&
          (!r.record.supersedes_id ||
            originals.get(String(r.record.supersedes_id))?.startTime === r.startTime),
      )
    )
      continue;
    const targets = fromTimes.map((t) => attendanceTarget(oldSlots, newSlots, t));
    if (
      targets.every((t) => !("error" in t)) &&
      new Set(targets.map((t) => t.time)).size === targets.length
    )
      continue;
    // Do not hide linked reports/reservations or any existing destination cell behind this exception.
    if (
      ctx.attendanceLinks.some(
        (l) =>
          l.studentId === a.studentId &&
          l.date === a.date &&
          [a.classId, toClassId].includes(l.classId),
      ) ||
      ctx.attendance.some(
        (r) => r.studentId === a.studentId && r.date === a.date && r.classId === toClassId,
      )
    )
      continue;

    // Keep exact-time anchors where possible, then distribute identical day-wide intent.
    // This is not a guess about which old lesson corresponds to which new lesson.
    const remaining = fromTimes.filter((t) => !toTimes.includes(t));
    const assigned = new Map(
      toTimes.map((t) => [t, fromTimes.includes(t) ? [t] : [remaining.shift()!]]),
    );
    assigned.get(toTimes[0]!)!.push(...remaining);
    for (const [toTime, sources] of assigned) {
      result.push({
        ids: rows.filter((r) => sources.includes(r.startTime!)).map((r) => r.id),
        studentId: a.studentId,
        studentName: ctx.students.find((s) => s.studentId === a.studentId)?.name ?? "학생",
        date: a.date,
        fromClassId: a.classId,
        fromClassName: ctx.classes.find((c) => c.id === a.classId)?.className ?? "이전 반",
        fromTime: sources[0]!,
        toClassId,
        toClassName:
          plan.mappings.find((m) => m.classId === toClassId)?.sheetName ?? moves[0]!.toClassName,
        toTime,
        absenceDay: { fromTimes, toTimes },
      });
    }
  }
  return result;
}
