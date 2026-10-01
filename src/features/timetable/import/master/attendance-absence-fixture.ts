import { attendanceFixture, record } from "./attendance-test-fixture";

export function wholeAbsenceFixture() {
  const f = attendanceFixture();
  const slot = f.ctx.schedules[0]!;
  f.ctx.schedules = [
    ...["18:20", "19:20", "20:20"].map((startTime, i) => ({
      ...slot,
      id: `old-${i}`,
      startTime,
      endTime: ["19:20", "20:10", "21:10"][i]!,
      slotTeacherLabel: i === 1 ? "Song" : "JJ",
    })),
    ...["17:20", "18:20"].map((startTime, i) => ({
      ...slot,
      id: `new-${i}`,
      classId: "c1",
      startTime,
      endTime: ["18:10", "19:20"][i]!,
      slotTeacherLabel: "Jane",
    })),
  ];
  f.ctx.attendance = ["18:20", "19:20", "20:20"].map((startTime, i) =>
    record(`a${i}`, {
      startTime,
      record: {
        ...record(`a${i}`).record,
        status: "absent",
        session_units: null,
        slot_start: `${startTime}:00`,
        note: "사전 결석 접수",
        recorded_via: "desk",
        recorded_at: `2026-09-28T06:29:4${i}.000000Z`,
      },
    }),
  );
  return f;
}
