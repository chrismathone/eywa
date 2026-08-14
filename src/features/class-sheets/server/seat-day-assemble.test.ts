import { describe, expect, it } from "vitest";
import { assembleSeatPeriods, type SeatAttRow, type SeatEnr } from "./seat-day-assemble";

const TABLES = { weekday: [], weekend: [] };

function enr(over: Partial<SeatEnr> & Pick<SeatEnr, "class_id" | "student_id">): SeatEnr {
  return {
    attendance_days: null,
    start_date: "2026-03-01",
    end_date: null,
    on_hold: false,
    is_transferred: false,
    students: [{ withdrawn_at: null }],
    ...over,
  };
}

describe("assembleSeatPeriods", () => {
  it("같은 시각 두 반을 한 표로 합친다", () => {
    const periods = assembleSeatPeriods({
      date: "2026-08-13",
      dow: "thu",
      slots: [
        { classId: "a", className: "중등E_의치대", startTime: "18:20:00", endTime: "19:20:00", slotTeacherLabel: "JJ" },
        { classId: "b", className: "중등E_최상위", startTime: "18:20:00", endTime: "19:20:00", slotTeacherLabel: "JJ" },
      ],
      enrollments: [enr({ class_id: "a", student_id: "s1" }), enr({ class_id: "b", student_id: "s2" })],
      marksRaw: [],
      attendanceRaw: [],
      studentRows: [
        { id: "s1", name: "김가", school: null, grade: null, english_name: null },
        { id: "s2", name: "이나", school: null, grade: null, english_name: null },
      ],
      canWriteEcs: true,
      attendanceWritable: true,
      teachingSet: null,
      periodTables: TABLES,
      weekend: false,
    });
    expect(periods).toHaveLength(1);
    expect(periods[0]!.students.every((s) => s.endedOn === null)).toBe(true);
    expect(periods[0]!.classNames).toEqual(["중등E_의치대", "중등E_최상위"]);
    expect(periods[0]!.students.map((s) => s.classId)).toEqual(["a", "b"]);
    expect(periods[0]!.form).toBe("selfStudy");
  });

  it("그 교시 출석만 붙인다 — 다른 시각·null 교시는 무시", () => {
    const att = (over: Partial<SeatAttRow>): SeatAttRow => ({
      id: "1",
      class_id: "a",
      student_id: "s1",
      status: "present",
      note: null,
      recorded_at: "2026-08-13T01:00:00Z",
      session_date: "2026-08-13",
      slot_start: "18:20:00",
      session_units: null,
      ...over,
    });
    const periods = assembleSeatPeriods({
      date: "2026-08-13",
      dow: "thu",
      slots: [
        { classId: "a", className: "의치대", startTime: "18:20", endTime: "19:20", slotTeacherLabel: "JJ" },
      ],
      enrollments: [enr({ class_id: "a", student_id: "s1" })],
      marksRaw: [],
      attendanceRaw: [
        att({ slot_start: "18:20:00", status: "absent" }),
        att({ id: "2", slot_start: "16:20:00", status: "present" }),
        att({ id: "3", slot_start: null, status: "present" }),
      ],
      studentRows: [{ id: "s1", name: "김가", school: null, grade: null, english_name: null }],
      canWriteEcs: true,
      attendanceWritable: true,
      teachingSet: null,
      periodTables: TABLES,
      weekend: false,
    });
    expect(periods[0]!.students[0]!.attendance?.status).toBe("absent");
  });

  it("재원생 end_date는 취소선용 endedOn이 아니다", () => {
    const periods = assembleSeatPeriods({
      date: "2026-08-13",
      dow: "thu",
      slots: [
        { classId: "a", className: "의치대", startTime: "18:20", endTime: "19:20", slotTeacherLabel: "JJ" },
      ],
      enrollments: [enr({ class_id: "a", student_id: "s1", end_date: "2026-12-31" })],
      marksRaw: [],
      attendanceRaw: [],
      studentRows: [{ id: "s1", name: "김가", school: null, grade: null, english_name: null }],
      canWriteEcs: true,
      attendanceWritable: true,
      teachingSet: null,
      periodTables: TABLES,
      weekend: false,
    });
    expect(periods[0]!.students[0]!.eligible).toBe(true);
    expect(periods[0]!.students[0]!.endedOn).toBeNull();
  });

  it("기록만 남은 학생은 읽기 전용으로 남긴다", () => {
    const periods = assembleSeatPeriods({
      date: "2026-08-13",
      dow: "thu",
      slots: [
        { classId: "a", className: "의치대", startTime: "18:20", endTime: "19:20", slotTeacherLabel: "JJ" },
      ],
      enrollments: [],
      marksRaw: [
        {
          class_id: "a",
          student_id: "ghost",
          slot_start: "18:20:00",
          status: "좋음",
          progress_note: "PL 7",
        },
      ],
      attendanceRaw: [],
      studentRows: [{ id: "ghost", name: "옛학생", school: null, grade: null, english_name: null }],
      canWriteEcs: true,
      attendanceWritable: true,
      teachingSet: null,
      periodTables: TABLES,
      weekend: false,
    });
    const row = periods[0]!.students[0]!;
    expect(row.historical).toBe(true);
    expect(row.canMarkAttendance).toBe(false);
    expect(row.canEditMark).toBe(false);
    expect(row.mark?.progressNote).toBe("PL 7");
  });
});
