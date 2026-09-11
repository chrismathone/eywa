import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { lessonStatus, type Classroom } from "./model";

export type PresenceStatus = "present" | "late" | "makeup";
export type ClassroomAttendee = { studentId: string; status: PresenceStatus };
export type PresenceRecord = EffectiveAttendanceRecord & { status: string; seat_label?: string | null };
const isPresent = (status: string): status is PresenceStatus => status === "present" || status === "late" || status === "makeup";

/** Match saved attendance to a known lesson, never multiply a day mark across periods. */
export function attachClassroomAttendance(rooms: Classroom[], rows: PresenceRecord[], date: string): Classroom[] {
  const startsByClass = new Map<string, Set<string>>();
  for (const room of rooms) for (const lesson of room.lessons) {
    if (!startsByClass.has(lesson.classId)) startsByClass.set(lesson.classId, new Set());
    startsByClass.get(lesson.classId)!.add(lesson.startTime.slice(0, 5));
  }
  const effective = effectiveAttendanceRecords(rows.filter((row) => row.session_date === date)
    .map((row) => ({ ...row, slot_start: row.slot_start?.slice(0, 5) ?? null })));
  const byClass = new Map<string, PresenceRecord[]>();
  for (const row of effective) {
    if (!byClass.has(row.class_id)) byClass.set(row.class_id, []);
    byClass.get(row.class_id)!.push(row);
  }
  return rooms.map((room) => ({ ...room, lessons: room.lessons.map((lesson) => {
    const seat = specialSlotLabel(lesson.teacherName);
    const candidates = byClass.get(lesson.classId) ?? [];
    const daily = startsByClass.get(lesson.classId)?.size === 1 && !seat
      ? candidates.filter((row) => !row.slot_start && !row.seat_label) : [];
    const exact = candidates.filter((row) => row.slot_start === lesson.startTime.slice(0, 5));
    // Even an exact absence must override a day-level presence before filtering statuses.
    const chosen = new Map([...daily, ...exact].map((row) => [row.student_id, row]));
    const attendance: ClassroomAttendee[] = [...chosen.values()]
      .filter((row) => isPresent(row.status) && (!row.seat_label || specialSlotLabel(row.seat_label) === seat))
      .map((row) => ({ studentId: row.student_id, status: row.status as PresenceStatus }))
      .sort((a, b) => a.studentId.localeCompare(b.studentId));
    return { ...lesson, attendance };
  }) }));
}

/** Count each student once per room; contradictory simultaneous room marks are not guessed. */
export function classroomAttendeesAt(rooms: Classroom[], minute: number | null): Record<string, ClassroomAttendee[]> {
  const byStudent = new Map<string, Map<string, PresenceStatus>>();
  for (const room of rooms) for (const lesson of room.lessons) {
    if (lessonStatus(lesson, minute) !== "ongoing") continue;
    for (const attendee of lesson.attendance ?? []) {
      if (!byStudent.has(attendee.studentId)) byStudent.set(attendee.studentId, new Map());
      byStudent.get(attendee.studentId)!.set(room.id, attendee.status);
    }
  }
  const result: Record<string, ClassroomAttendee[]> = {};
  for (const [studentId, locations] of [...byStudent].sort(([a], [b]) => a.localeCompare(b))) {
    if (locations.size !== 1) continue;
    const [roomId, status] = [...locations][0];
    (result[roomId] ??= []).push({ studentId, status });
  }
  return result;
}

export function classroomPeopleAt(rooms: Classroom[], minute: number | null): Record<string, PresenceStatus[]> {
  return Object.fromEntries(Object.entries(classroomAttendeesAt(rooms, minute)).map(([id, students]) => [id, students.map((s) => s.status)]));
}
