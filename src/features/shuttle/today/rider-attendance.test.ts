import { describe, expect, it } from "vitest";
import { buildRiderAttendance, riderAttendanceText, type AttendanceRow } from "./rider-attendance";

const rec = (p: Partial<AttendanceRow>): AttendanceRow => ({
  id: "a1",
  student_id: "s1",
  class_id: "c1",
  session_date: "2026-10-30",
  slot_start: "16:00:00",
  status: "present",
  recorded_by: "u1",
  recorded_via: "teacher",
  seat_label: null,
  access_method: "manual",
  recorded_at: "2026-10-30T07:05:00Z",
  ...p,
});
const classes = new Map([["c1", "중등 수학 A반"], ["c2", "초등 영어"]]);
const users = new Map([["u1", "박소선"]]);
const schedules = new Map([
  ["c1", [{ class_id: "c1", start_time: "16:00:00", end_time: "17:50:00", room: "본원302" }]],
  [
    "c2",
    [
      { class_id: "c2", start_time: "15:00:00", end_time: "15:40:00", room: "바른602" },
      { class_id: "c2", start_time: "16:20:00", end_time: "17:00:00", room: "바른603" },
    ],
  ],
]);

describe("buildRiderAttendance — 하원 줄의 '출석함 · 누가 · 어디서'", () => {
  it("🔑 출석 = 찍은 선생님 · 반 · 교시 시각 · 강의실", () => {
    const got = buildRiderAttendance([rec({})], classes, users, schedules);
    expect(got.s1!.map(riderAttendanceText)).toEqual(["출석함 · 박소선 선생님 · 중등 수학 A반 16:00~17:50 · 본원302"]);
  });
  it("🔑 최신 정정 한 줄만 본다 — 출석 뒤 결석으로 고치면 안 띄우고, 결석 뒤 지각으로 고치면 '출석함(지각)'", () => {
    expect(buildRiderAttendance([rec({}), rec({ id: "a2", status: "absent", recorded_at: "2026-10-30T07:10:00Z" })], classes, users, schedules)).toEqual({});
    const late = buildRiderAttendance([rec({ status: "absent" }), rec({ id: "a2", status: "late", recorded_at: "2026-10-30T07:10:00Z" })], classes, users, schedules);
    expect(riderAttendanceText(late.s1![0]!)).toBe("출석함(지각) · 박소선 선생님 · 중등 수학 A반 16:00~17:50 · 본원302");
  });
  it("사람이 없는 기록은 방법으로 · 교시가 여럿인데 기록에 교시가 없으면 시각·강의실을 비운다", () => {
    const kiosk = buildRiderAttendance([rec({ recorded_by: null, recorded_via: "kiosk", access_method: "kiosk" })], classes, users, schedules);
    expect(riderAttendanceText(kiosk.s1![0]!)).toBe("출석함 · 키오스크 · 중등 수학 A반 16:00~17:50 · 본원302");
    const seat = buildRiderAttendance([rec({ class_id: "c2", slot_start: "16:20:00", recorded_by: null, recorded_via: "seat", seat_label: "LAB실" })], classes, users, schedules);
    expect(riderAttendanceText(seat.s1![0]!)).toBe("출석함 · LAB실 PIN · 초등 영어 16:20~17:00 · 바른603");
    const unknownSlot = buildRiderAttendance([rec({ class_id: "c2", slot_start: null })], classes, users, schedules);
    expect(riderAttendanceText(unknownSlot.s1![0]!)).toBe("출석함 · 박소선 선생님 · 초등 영어");
  });
  it("한 학생의 여러 수업은 시각 순", () => {
    const got = buildRiderAttendance([rec({}), rec({ id: "b", class_id: "c2", slot_start: "15:00:00" })], classes, users, schedules);
    expect(got.s1!.map((a) => a.className)).toEqual(["초등 영어", "중등 수학 A반"]);
  });
});
