import {
  classTeacherIdsInRange,
  ownsAttendanceSlot,
  type AxisSlot,
} from "./teacher-axis";

export type TeacherProcessing = {
  teacherId: string;
  expected: number;
  recorded: number;
};
export type ProcessingRecord = {
  student_id: string;
  slot_start: string | null;
  seat_label: string | null;
};

/** 허브 카드도 강사 출석부와 같은 교시 귀속으로 센다. 반 전체 기록을 담임에게 복제하지 않는다. */
export function teacherProcessing(input: {
  date: string;
  homeroomTeacherId: string | null;
  slots: AxisSlot[];
  expectedStudents: ReadonlySet<string>;
  records: ProcessingRecord[];
}): TeacherProcessing[] {
  const { date, homeroomTeacherId, slots, expectedStudents, records } = input;
  return classTeacherIdsInRange({
    homeroomTeacherId,
    slots,
    from: date,
    to: date,
  }).flatMap((teacherId) => {
    const owns = (slotStart: string | null, seatLabel: string | null = null) =>
      ownsAttendanceSlot({
        scopeTeacherId: teacherId,
        homeroomTeacherId,
        slots,
        date,
        slotStart,
        seatLabel,
      });
    if (!slots.some((slot) => owns(slot.startTime))) return [];
    const recorded = new Set(
      records
        .filter(
          (r) =>
            expectedStudents.has(r.student_id) &&
            owns(r.slot_start, r.seat_label),
        )
        .map((r) => r.student_id),
    ).size;
    return [{ teacherId, expected: expectedStudents.size, recorded }];
  });
}
