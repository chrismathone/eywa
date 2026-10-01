import { expect, it } from "vitest";
import type postgres from "postgres";
import { wholeAbsenceFixture } from "../import/master/attendance-absence-fixture";
import { planAttendanceMigration } from "../import/master/attendance-migration";
import {
  attendanceBackups,
  applyAttendanceMoves,
  rollbackAttendanceMoves,
} from "./master-sheet-attendance";

it("3칸→2칸 결석 이관은 원본 3행을 보존하고 취소할 때 각 원래 교시로 복원한다", async () => {
  const { plan, ctx } = wholeAbsenceFixture();
  const original = structuredClone(ctx.attendance.map((a) => a.record));
  const backups = attendanceBackups(planAttendanceMigration(plan, ctx).moves, ctx.attendance);
  expect(backups).toHaveLength(3);
  expect(new Set(backups.map((b) => b.after.slot_start))).toEqual(
    new Set(["17:20:00", "18:20:00"]),
  );
  for (const b of backups) {
    expect(b.before).toEqual(original.find((r) => r.id === b.before.id));
    expect(b.after).toEqual({ ...b.before, class_id: "c1", slot_start: b.after.slot_start });
  }
  const writes: unknown[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      if (strings.join("").includes("update attendance_records")) {
        writes.push(args[0]);
        return ctx.attendance.map((r) => ({ id: r.id }));
      }
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  await expect(applyAttendanceMoves(tx, "tenant", backups)).resolves.toBe(3);
  await rollbackAttendanceMoves(tx, "tenant", backups);
  expect(writes).toEqual([backups, backups.map((b) => ({ before: b.after, after: b.before }))]);
  expect(backups.map((b) => b.before.slot_start).sort()).toEqual([
    "18:20:00",
    "19:20:00",
    "20:20:00",
  ]);
});
