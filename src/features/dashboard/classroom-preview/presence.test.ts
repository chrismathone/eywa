import { describe, expect, it } from "vitest";
import { attachClassroomAttendance, classroomPeopleAt, type PresenceRecord } from "./presence";
import type { Classroom, ClassroomLesson } from "./model";

const date = "2026-09-11";
const lesson: ClassroomLesson = { id: "l1", classId: "c1", className: "A", subject: "english", teacherName: "강사", startTime: "14:00:00", endTime: "15:00:00", studentCount: 9 };
const room: Classroom = { id: "r1", name: "본원201", capacity: 12, registered: true, lessons: [lesson] };
const record = (patch: Partial<PresenceRecord> = {}): PresenceRecord => ({ id: "a", student_id: "s1", class_id: "c1", session_date: date, slot_start: "14:00:00", status: "present", recorded_at: `${date}T05:00:00Z`, ...patch });

describe("classroom students from saved attendance", () => {
  it("uses latest corrections and shows only present, late and makeup during that period", () => {
    const result = attachClassroomAttendance([room], [record(), record({ id: "b", status: "absent", recorded_at: `${date}T05:10:00Z` }), record({ id: "c", student_id: "s2", status: "late" }), record({ id: "d", student_id: "s3", status: "makeup" }), record({ id: "e", student_id: "s4", status: "early_leave" })], date);
    expect(classroomPeopleAt(result, 850)).toEqual({ r1: ["late", "makeup"] });
    expect(classroomPeopleAt(result, 839)).toEqual({});
    expect(classroomPeopleAt(result, 900)).toEqual({});
    expect(classroomPeopleAt(result, null)).toEqual({});
    expect(result[0].lessons[0].studentCount).toBe(9);
  });
  it("never clones a day record into multiple lesson periods or a special seat", () => {
    const second = { ...lesson, id: "l2", startTime: "15:00:00", endTime: "16:00:00" };
    const rows = [record({ slot_start: null })];
    expect(classroomPeopleAt(attachClassroomAttendance([{ ...room, lessons: [lesson, second] }], rows, date), 850)).toEqual({});
    expect(classroomPeopleAt(attachClassroomAttendance([{ ...room, lessons: [{ ...lesson, teacherName: "LAB" }] }], rows, date), 850)).toEqual({});
    expect(classroomPeopleAt(attachClassroomAttendance([room], rows, date), 850)).toEqual({ r1: ["present"] });
  });
  it("lets an exact absence override a day presence and excludes other dates or seats", () => {
    const rows = [record({ slot_start: null }), record({ id: "b", status: "absent" }), record({ id: "c", student_id: "s2", seat_label: "LAB" }), record({ id: "d", student_id: "s3", session_date: "2026-09-10" })];
    expect(classroomPeopleAt(attachClassroomAttendance([room], rows, date), 850)).toEqual({});
  });
  it("deduplicates shared classes within a room and does not guess contradictory rooms", () => {
    const marked = attachClassroomAttendance([room], [record()], date)[0];
    expect(classroomPeopleAt([{ ...marked, lessons: [...marked.lessons, ...marked.lessons] }], 850)).toEqual({ r1: ["present"] });
    expect(classroomPeopleAt([marked, { ...marked, id: "r2", name: "본원202" }], 850)).toEqual({});
  });
});
