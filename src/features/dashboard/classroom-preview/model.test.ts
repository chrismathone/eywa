import { describe, expect, it } from "vitest";
import { classroomLayout, lessonStatus, roomAt, type ClassroomLesson } from "./model";

const rooms = [
  { id: "r201", name: "본원201", capacity: 12 },
  { id: "r603", name: "본원603", capacity: 16 },
];
const lesson: ClassroomLesson = {
  id: "s1", classId: "c1", className: "영어 A", subject: "english",
  startTime: "14:20:00", endTime: "15:00:00", teacherName: "교시 강사", studentCount: 7,
};
const slot = { ...lesson, slotRoomId: "r603", classRoomId: "r201", slotRoomLabel: null, classroomName: "본원603" };

describe("classroom preview room mapping", () => {
  it("keeps the slot override and its exact lesson count instead of the homeroom", () => {
    const result = classroomLayout(rooms, [slot]);
    expect(result.rooms.find((r) => r.id === "r201")?.lessons).toEqual([]);
    expect(result.rooms.find((r) => r.id === "r603")?.lessons).toEqual([lesson]);
  });
  it("maps a unique sheet label, and never drops an unknown override into the default room", () => {
    const result = classroomLayout(rooms, [
      { ...slot, slotRoomId: null, slotRoomLabel: "본원 603" },
      { ...slot, id: "s2", slotRoomId: null, slotRoomLabel: "별도 교실" },
    ]);
    expect(result.rooms.find((r) => r.id === "r603")?.lessons).toHaveLength(1);
    expect(result.rooms.find((r) => r.id === "r201")?.lessons).toHaveLength(0);
    expect(result.rooms.find((r) => r.id === "label:별도 교실")?.registered).toBe(false);
  });
  it("does not guess when two registered rooms have the same name", () => {
    const result = classroomLayout([...rooms, { ...rooms[1], id: "other" }], [{ ...slot, slotRoomId: null, slotRoomLabel: "본원603" }]);
    expect(result.rooms.find((r) => r.id === "label:본원603")?.lessons).toHaveLength(1);
    expect(result.rooms.find((r) => r.id === "r603")?.lessons).toHaveLength(0);
  });
  it("retains unassigned lessons and hides unused archived rooms", () => {
    const result = classroomLayout([...rooms, { id: "old", name: "보관", capacity: 10, archived_at: "2026-01-01" }], [
      { ...slot, slotRoomId: null, classRoomId: null, slotRoomLabel: null, classroomName: null },
    ]);
    expect(result.unassigned).toEqual([lesson]);
    expect(result.rooms.map((r) => r.id)).toEqual(["r201", "r603"]);
  });
  it("retains today's archived assignment and removes empty rooms in teacher scope", () => {
    const result = classroomLayout(rooms.map((r) => ({ ...r, archived_at: "2026-01-01" })), [slot], true);
    expect(result.rooms.map((r) => r.id)).toEqual(["r603"]);
  });
});

describe("classroom preview clock", () => {
  it("uses inclusive starts and exclusive ends at a period boundary", () => {
    expect(lessonStatus(lesson, 859)).toBe("upcoming");
    expect(lessonStatus(lesson, 860)).toBe("ongoing");
    expect(lessonStatus(lesson, 900)).toBe("done");
  });
  it("does not present another day's or malformed timetable as currently idle", () => {
    const room = { ...rooms[0], registered: true, lessons: [lesson] };
    expect(roomAt(room, null)).toMatchObject({ status: "unknown", active: [], next: undefined });
    expect(lessonStatus({ ...lesson, endTime: "invalid" }, 880)).toBe("unknown");
  });
  it("deduplicates simultaneous cells of one class without hiding parallel classes", () => {
    const room = { ...rooms[0], registered: true, lessons: [lesson, { ...lesson, id: "duplicate" }, { ...lesson, id: "s3", classId: "c2" }] };
    expect(roomAt(room, 880).active.map((s) => s.classId)).toEqual(["c1", "c2"]);
    expect(roomAt(room, 850).next?.classId).toBe("c1");
    expect(roomAt(room, 900).active).toEqual([]);
  });
});
