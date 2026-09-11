import { lessonStatus, type Classroom, type ClassroomLesson } from "./model";
import { classroomAttendeesAt, type PresenceStatus } from "./presence";

export type RoomSeating = {
  /** Same roster order for empty and occupied seats; no student identities reach WebGL. */
  seats: (PresenceStatus | null)[];
  /** Daily maximum keeps the grid fixed when one period replaces another. */
  layoutCount: number;
  rosterAvailable: boolean;
  attendanceAvailable: boolean;
};

function rosterOf(lessons: ClassroomLesson[]) {
  return new Set(lessons.flatMap((lesson) => lesson.studentIds ?? []));
}

export function classroomSeatingAt(rooms: Classroom[], minute: number | null, useAttendance = true): Record<string, RoomSeating> {
  const attendees = useAttendance ? classroomAttendeesAt(rooms, minute) : {};
  return Object.fromEntries(rooms.map((room) => {
    const active = room.lessons.filter((lesson) => lessonStatus(lesson, minute) === "ongoing");
    const rosterAvailable = active.every((lesson) => lesson.studentIds !== undefined);
    const roster = rosterOf(active);
    // A saved makeup attendance is an additional attendee, never a phantom duplicate.
    const makeup = new Set((attendees[room.id] ?? []).filter((a) => a.status === "makeup").map((a) => a.studentId));
    const regular = [...roster].sort();
    const extras = [...makeup].filter((id) => !roster.has(id)).sort();
    const byStudent = new Map((attendees[room.id] ?? []).map((a) => [a.studentId, a.status]));
    const seats = rosterAvailable ? [...regular, ...extras].map((id) => byStudent.get(id) ?? null) : [];
    // Peak enrollment across concurrent periods; a duplicated timetable cell adds no desks.
    const starts = [...new Set(room.lessons.map((l) => l.startTime))];
    const peak = starts.reduce((max, start) => {
      const [h, m] = start.split(":").map(Number);
      const concurrent = room.lessons.filter((l) => lessonStatus(l, h * 60 + m) === "ongoing");
      return Math.max(max, rosterOf(concurrent).size);
    }, 0);
    return [room.id, { seats, layoutCount: Math.max(peak, seats.length), rosterAvailable, attendanceAvailable: useAttendance }];
  }));
}
