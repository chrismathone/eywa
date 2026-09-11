import { describe, expect, it } from "vitest";
import { classroomSeatingAt } from "./seating";
import { attachClassroomAttendance, type PresenceRecord } from "./presence";
import { classroomLayout, type Classroom, type ClassroomLesson } from "./model";
import { buildSceneLayout, classroomSeats } from "./scene-layout";

const ids = Array.from({ length: 10 }, (_, i) => `s${String(i).padStart(2, "0")}`);
const lesson: ClassroomLesson = { id: "l1", classId: "c1", className: "A", subject: "english", teacherName: "강사", startTime: "14:00:00", endTime: "15:00:00", studentCount: 10, studentIds: ids };
const room: Classroom = { id: "r1", name: "본원201", capacity: 16, registered: true, lessons: [lesson] };
const record = (student: string, patch: Partial<PresenceRecord> = {}): PresenceRecord => ({ id: student, student_id: student, class_id: "c1", session_date: "2026-09-11", slot_start: "14:00:00", status: "present", recorded_at: "2026-09-11T05:00:00Z", ...patch });

describe("desks for current enrolled students", () => {
  it("preserves roster membership through room assignment", () => {
    const result = classroomLayout([room], [{ ...lesson, slotRoomId: "r1", classRoomId: "r1", slotRoomLabel: null, classroomName: room.name }]);
    expect(result.rooms[0].lessons[0].studentIds).toEqual(ids);
  });
  it("shows 10 desks and 7 seated students, leaving their three exact places empty", () => {
    const records = ids.filter((_, i) => ![1, 4, 8].includes(i)).map((id) => record(id));
    const marked = attachClassroomAttendance([room], records, "2026-09-11");
    const seating = classroomSeatingAt(marked, 850).r1;
    expect(seating.seats).toEqual(["present", null, "present", "present", null, "present", "present", "present", null, "present"]);
    expect(seating.seats.filter(Boolean)).toHaveLength(7);
    expect(classroomSeatingAt(marked, 850, false).r1.seats).toEqual(Array(10).fill(null));
    expect(classroomSeatingAt(marked, 850, false).r1.attendanceAvailable).toBe(false);
  });
  it("changes only the corrected student's place and keeps the other students seated", () => {
    const records = ids.map((id) => record(id));
    const before = classroomSeatingAt(attachClassroomAttendance([room], records, "2026-09-11"), 850).r1;
    const corrected = [...records, record(ids[1], { id: "correction", status: "absent", recorded_at: "2026-09-11T05:10:00Z" })];
    const after = classroomSeatingAt(attachClassroomAttendance([room], corrected, "2026-09-11"), 850).r1;
    expect(after.seats).toEqual(before.seats.map((value, i) => i === 1 ? null : value));
    expect(after.layoutCount).toBe(before.layoutCount);
  });
  it("deduplicates students across concurrent classes and repeated timetable cells", () => {
    const second = { ...lesson, id: "l2", classId: "c2", studentIds: [ids[0], "extra"], studentCount: 2 };
    const seating = classroomSeatingAt([{ ...room, lessons: [lesson, lesson, second] }], 850).r1;
    expect(seating.seats).toHaveLength(11);
    expect(seating.layoutCount).toBe(11);
  });
  it("switches desk counts exactly at the period boundary while retaining the daily grid", () => {
    const later = { ...lesson, id: "l2", classId: "c2", startTime: "15:00:00", endTime: "16:00:00", studentIds: ["a", "b", "c"], studentCount: 3 };
    const rooms = [{ ...room, lessons: [lesson, later] }];
    expect(classroomSeatingAt(rooms, 839).r1.seats).toHaveLength(0);
    const before = classroomSeatingAt(rooms, 899).r1, after = classroomSeatingAt(rooms, 900).r1;
    expect(before.seats).toHaveLength(10); expect(after.seats).toHaveLength(3);
    expect(before.layoutCount).toBe(after.layoutCount);
    expect(classroomSeatingAt(rooms, 960).r1.seats).toHaveLength(0);
    expect(classroomSeatingAt(rooms, null).r1.seats).toHaveLength(0);
  });
  it("adds a confirmed makeup desk, ignores stale non-roster marks and preserves regular order", () => {
    const marked = attachClassroomAttendance([room], [record(ids[1]), record("guest", { status: "makeup" }), record("stale")], "2026-09-11");
    const seats = classroomSeatingAt(marked, 850).r1.seats;
    expect(seats).toHaveLength(11); expect(seats[1]).toBe("present"); expect(seats[10]).toBe("makeup");
    expect(seats.filter(Boolean)).toHaveLength(2);
  });
  it("retains empty desks for contradictory attendance locations without duplicating students", () => {
    const marked = attachClassroomAttendance([room, { ...room, id: "r2" }], [record(ids[0])], "2026-09-11");
    const result = classroomSeatingAt(marked, 850);
    expect(result.r1.seats).toEqual(Array(10).fill(null));
    expect(result.r2.seats).toEqual(Array(10).fill(null));
  });
  it("uses a stable grid for a lab exceeding 24 and does not invent a missing roster", () => {
    const lab = { ...room, name: "본원603", lessons: [{ ...lesson, studentIds: Array.from({ length: 29 }, (_, i) => `s${i}`), studentCount: 29 }] };
    const seating = classroomSeatingAt([lab], 850).r1;
    const placed = buildSceneLayout([lab]).rooms[0];
    const positions = classroomSeats(placed, seating.layoutCount);
    expect(seating.seats).toHaveLength(29); expect(positions).toHaveLength(29);
    expect(new Set(positions.map((p) => `${p.x}:${p.z}`)).size).toBe(29);
    expect(classroomSeatingAt([{ ...room, lessons: [{ ...lesson, studentIds: undefined }] }], 850).r1).toMatchObject({ seats: [], rosterAvailable: false });
  });
});
