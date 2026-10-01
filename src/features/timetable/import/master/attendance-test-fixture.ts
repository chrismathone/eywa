import { fixture } from "./test-fixture";
import { buildMasterPlan } from "./plan";
import type { MasterAttendance } from "./attendance-types";
import type { ExistingSchedule } from "../structure/types";

export const record = (
  id = "a",
  patch: Partial<MasterAttendance> = {},
): MasterAttendance => ({
  id,
  classId: "old",
  studentId: "s1",
  date: "2026-10-01",
  startTime: "14:20",
  record: {
    id,
    tenant_id: "tenant",
    class_id: "old",
    student_id: "s1",
    session_date: "2026-10-01",
    slot_start: "14:20:00",
    status: "present",
    session_units: 1.5,
    note: "원래 메모",
    recorded_by: "teacher",
    recorded_at: "2026-10-01T00:00:00+00:00",
    supersedes_id: null,
  },
  ...patch,
});
export function attendanceFixture() {
  const f = fixture();
  f.ctx.classes.push({ ...f.ctx.classes[0]!, id: "old", className: "이전반" });
  f.ctx.enrollments.push({
    id: "e1",
    studentId: "s1",
    classId: "old",
    startDate: "2026-09-01",
    endDate: null,
    onHold: false,
    isTransferred: false,
    attendanceDays: [],
  });
  const slot: ExistingSchedule = {
    id: "slot",
    classId: "old",
    className: "이전반",
    day: "thu",
    startTime: "14:20",
    endTime: "15:00",
    teacherId: "t1",
    classroomId: "r1",
    slotTeacherLabel: "Anna",
    slotRoomLabel: "605",
    mergeGroup: null,
    validFrom: "2026-09-01",
    validTo: null,
  };
  f.ctx.schedules.push(slot, {
    ...slot,
    id: "new-slot",
    classId: "c1",
    className: "PL2",
  });
  const plan = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
  // Focus the migration unit on a move. The full planner has its own schedule/roster tests.
  plan.report.planItems = [];
  plan.roster.moves = [
    {
      enrollmentId: "e1",
      studentName: "김하나",
      fromClassName: "이전반",
      toClassId: "c1",
      toClassName: "PL2",
    },
  ];
  f.ctx.attendance = [record()];
  return { ...f, plan };
}
