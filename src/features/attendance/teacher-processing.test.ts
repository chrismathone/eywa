import { describe, expect, it } from "vitest";
import type { AxisSlot } from "./teacher-axis";
import { teacherProcessing } from "./teacher-processing";

const slot = (
  startTime: string,
  teacherId: string | null,
  slotTeacherLabel: string | null = null,
): AxisSlot => ({
  dayOfWeek: "fri",
  startTime,
  teacherId,
  slotTeacherLabel,
  validFrom: "2026-09-01",
  validTo: null,
});

describe("강사별 오늘 입력 현황", () => {
  it("PL4 다른 강사 두 교시의 9명 기록을 담임 정유진에게 복제하지 않는다", () => {
    const students = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const rows = teacherProcessing({
      date: "2026-09-11",
      homeroomTeacherId: "yoojin",
      slots: [
        slot("16:20", "kristine"),
        slot("17:00", null, "LAB"),
        slot("17:40", "florence"),
      ],
      expectedStudents: new Set(students),
      records: students.flatMap((student_id) =>
        ["16:20:00", "17:40:00"].map((slot_start) => ({
          student_id,
          slot_start,
          seat_label: null,
        })),
      ),
    });
    expect(rows).toEqual([
      { teacherId: "kristine", expected: 9, recorded: 9 },
      { teacherId: "florence", expected: 9, recorded: 9 },
    ]);
  });
  it("LE1 내 교시 미입력은 0/8이고 LAB·남의 교시·예정 외 학생은 내 입력에 안 섞인다", () => {
    const input = {
      date: "2026-09-11",
      homeroomTeacherId: "yoojin",
      slots: [
        slot("15:00", "yoojin"),
        slot("15:40", null, "LAB"),
        slot("16:20", "daniella"),
      ],
      expectedStudents: new Set(Array.from({ length: 8 }, (_, i) => `s${i}`)),
      records: [
        { student_id: "s0", slot_start: "15:40", seat_label: "LAB" },
        { student_id: "s1", slot_start: "16:20", seat_label: null },
        { student_id: "outside", slot_start: "15:00", seat_label: null },
      ],
    };
    expect(
      teacherProcessing(input).find((r) => r.teacherId === "yoojin"),
    ).toEqual({ teacherId: "yoojin", expected: 8, recorded: 0 });
    input.records.push(
      { student_id: "s0", slot_start: "15:00", seat_label: null },
      { student_id: "s0", slot_start: "15:00:00", seat_label: null },
    );
    expect(
      teacherProcessing(input).find((r) => r.teacherId === "yoojin")?.recorded,
    ).toBe(1);
  });
  it("교시 담당을 지정하지 않는 수학은 담임 기준과 하루 단위 기록을 유지한다", () => {
    expect(
      teacherProcessing({
        date: "2026-09-11",
        homeroomTeacherId: "math",
        slots: [slot("16:00", null)],
        expectedStudents: new Set(["s"]),
        records: [{ student_id: "s", slot_start: null, seat_label: null }],
      }),
    ).toEqual([{ teacherId: "math", expected: 1, recorded: 1 }]);
  });
});
