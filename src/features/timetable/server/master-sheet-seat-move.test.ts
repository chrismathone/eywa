import { expect, it } from "vitest";
import { attendanceFixture, record } from "../import/master/attendance-test-fixture";
import { planAttendanceMigration } from "../import/master/attendance-migration";
import { attendanceBackups, rollbackAttendanceMoves } from "./master-sheet-attendance";
import { ownsAttendanceSlot } from "@/features/attendance/teacher-axis";
import type postgres from "postgres";

it("같은 반·시각의 LAB→일반 수업도 오늘 기록만 새 강사 축으로 이관하고 이전 기록은 그대로 둔다", async () => {
  const { plan, ctx } = attendanceFixture();
  plan.roster.moves = [];
  ctx.attendance[0]!.record.seat_label = "LAB";
  ctx.attendance[0]!.record.recorded_via = "seat";
  ctx.schedules[0]!.slotTeacherLabel = "LAB";
  ctx.attendance.push(record("yesterday", { date: "2026-09-30" }));
  plan.report.planItems = [
    {
      action: "update",
      scheduleId: "slot",
      classId: "old",
      className: "이전반",
      day: "thu",
      startTime: "14:20",
      endTime: "15:00",
      teacherNames: ["Anna"],
      teacherId: "t1",
      room: "605",
    },
  ];
  const result = planAttendanceMigration(plan, ctx);
  expect(result.issues.map((i) => i.severity)).toEqual(["confirm"]);
  expect(result.moves).toHaveLength(1);
  const rows = attendanceBackups(result.moves, ctx.attendance);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.after).toEqual({ ...rows[0]!.before, seat_label: null, recorded_via: null });
  expect(rows[0]!.before).toMatchObject({ seat_label: "LAB", recorded_via: "seat" });
  expect(
    ownsAttendanceSlot({
      scopeTeacherId: "t1",
      homeroomTeacherId: "t1",
      date: "2026-10-01",
      slotStart: "14:20",
      seatLabel: rows[0]!.after.seat_label as null,
      recordedVia: rows[0]!.after.recorded_via as null,
      slots: [
        {
          dayOfWeek: "thu",
          startTime: "14:20",
          teacherId: "t1",
          slotTeacherLabel: "Anna",
          validFrom: "2026-10-01",
          validTo: null,
        },
      ],
    }),
  ).toBe(true);
  let restored: unknown;
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      if (strings.join("").includes("update attendance_records")) {
        restored = args[0];
        return [{ id: "a" }];
      }
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  await rollbackAttendanceMoves(tx, "tenant", rows);
  expect(restored).toEqual(rows.map((b) => ({ before: b.after, after: b.before })));
});
