import type { TodaySlot } from "@/features/timetable/server/queries";
import type { RoomInfo } from "@/features/timetable/lib/room-grid";
import { groupRooms } from "@/features/timetable/lib/room-groups";
import { timeToMin } from "@/features/timetable/lib/ten-minute-grid";
import type { ClassroomAttendee } from "./presence";

export type ClassroomLesson = Pick<TodaySlot,
  "id" | "classId" | "className" | "subject" | "startTime" | "endTime" |
  "teacherName" | "studentCount"
> & { studentIds?: string[]; attendance?: ClassroomAttendee[] };
type SourceSlot = ClassroomLesson & Pick<TodaySlot, "slotRoomId" | "classRoomId" | "slotRoomLabel" | "classroomName">;
export type Classroom = RoomInfo & { registered: boolean; lessons: ClassroomLesson[] };
export type ClassroomSnapshot = {
  scope: string;
  tenantId: string;
  date: string;
  at: number;
  scoped: boolean;
  attendanceAvailable: boolean;
  subjects: Record<string, string>;
  rooms: Classroom[];
  unassigned: ClassroomLesson[];
};

/** Names only join when unique. A sheet override must never fall back to another room's FK. */
export function classroomLayout(
  rooms: (RoomInfo & { archived_at?: string | null })[],
  slots: SourceSlot[],
  scoped = false,
) {
  const normalize = (name: string) => name.trim().replace(/\s+/g, "");
  const byName = new Map<string, RoomInfo[]>();
  for (const room of rooms) {
    const name = normalize(room.name);
    byName.set(name, [...(byName.get(name) ?? []), room]);
  }
  const buckets = new Map<string, Classroom>(rooms.map((room) => [room.id, {
    id: room.id, name: room.name, capacity: room.capacity, registered: true, lessons: [],
  }]));
  const unassigned: ClassroomLesson[] = [];
  for (const slot of slots) {
    const label = (slot.slotRoomLabel || slot.classroomName || "").trim();
    const matches = byName.get(normalize(label));
    const matchedId = matches?.length === 1 ? matches[0].id : null;
    const id = slot.slotRoomId || (slot.slotRoomLabel ? matchedId : slot.classRoomId || matchedId);
    const lesson: ClassroomLesson = {
      id: slot.id, classId: slot.classId, className: slot.className, subject: slot.subject,
      startTime: slot.startTime, endTime: slot.endTime, teacherName: slot.teacherName,
      studentCount: slot.studentCount,
      ...(slot.studentIds ? { studentIds: slot.studentIds } : {}),
    };
    if (!id && !label) { unassigned.push(lesson); continue; }
    const key = id || `label:${label}`;
    const room = buckets.get(key) ?? {
      id: key, name: label || "등록 정보 없는 교실", capacity: null, registered: false, lessons: [],
    };
    room.lessons.push(lesson);
    buckets.set(key, room);
  }
  const archived = new Set(rooms.filter((room) => room.archived_at).map((room) => room.id));
  return {
    rooms: groupRooms([...buckets.values()].filter((room) =>
      room.lessons.length > 0 || (!scoped && !archived.has(room.id)),
    )),
    unassigned,
  };
}

export function lessonStatus(lesson: ClassroomLesson, minute: number | null) {
  if (minute === null) return "unknown";
  const start = timeToMin(lesson.startTime);
  const end = timeToMin(lesson.endTime);
  if (start === null || end === null || end <= start) return "unknown";
  return minute >= end ? "done" : minute >= start ? "ongoing" : "upcoming";
}

export function roomAt(room: Classroom, minute: number | null) {
  const ordered = [...room.lessons].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  const current = ordered.filter((lesson) => lessonStatus(lesson, minute) === "ongoing");
  const next = ordered.find((lesson) => lessonStatus(lesson, minute) === "upcoming");
  // Repeated timetable cells of the same class are one current class, not extra students.
  const active = [...new Map(current.map((lesson) => [lesson.classId, lesson])).values()];
  const status: "unknown" | "ongoing" | "idle" = minute === null ? "unknown" : active.length ? "ongoing" : "idle";
  return { active, next, ordered, status };
}

export function minuteLabel(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
