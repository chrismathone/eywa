import { describe, expect, it } from "vitest";
import { wholeAbsenceFixture } from "./attendance-absence-fixture";
import { planAttendanceMigration } from "./attendance-migration";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";

describe("전교시 사전 결석의 반이동", () => {
  it("JJ 포함 기존 3교시를 새 2교시 결석으로 연결하고 모든 ID를 한 번씩 보존한다", () => {
    const { plan, ctx } = wholeAbsenceFixture();
    const original = structuredClone(ctx);
    const r = planAttendanceMigration(plan, ctx);
    expect(r.issues.map((i) => i.severity)).toEqual(["confirm"]);
    expect(r.moves).toHaveLength(2);
    expect(r.moves.map((m) => m.toTime)).toEqual(["17:20", "18:20"]);
    expect(r.moves.flatMap((m) => m.ids).sort()).toEqual(["a0", "a1", "a2"]);
    expect(r.moves[0]?.absenceDay).toEqual({
      fromTimes: ["18:20", "19:20", "20:20"],
      toTimes: ["17:20", "18:20"],
    });
    const after = ctx.attendance.map((a) => ({
      id: a.id,
      student_id: a.studentId,
      class_id: "c1",
      session_date: a.date,
      slot_start: r.moves.find((m) => m.ids.includes(a.id))!.toTime,
      recorded_at: String(a.record.recorded_at),
      status: a.record.status,
    }));
    expect(effectiveAttendanceRecords(after).map((a) => a.status)).toEqual(["absent", "absent"]);
    expect(ctx).toEqual(original);
  });
  it.each([
    ["status", "present"],
    ["status", "excused"],
    ["status", "makeup"],
    ["session_units", 1],
    ["seat_label", "JJ"],
    ["taught_by", "teacher"],
    ["salary_tier", "override"],
    ["note", "다른 사유"],
    ["homework_done", true],
    ["recorded_by", "other"],
    ["recorded_via", "ecs"],
    ["supersedes_id", "outside"],
    ["recorded_at", "bad"],
    ["recorded_at", "2026-10-01T08:20:00Z"],
  ])("%s=%s는 하루 결석으로 단정하지 않는다", (field, value) => {
    const { plan, ctx } = wholeAbsenceFixture();
    ctx.attendance[0]!.record[field] = value;
    const r = planAttendanceMigration(plan, ctx);
    expect(r.moves.some((m) => m.absenceDay)).toBe(false);
    expect(r.issues.some((i) => i.severity === "error")).toBe(true);
  });
  it("일부 교시만 결석이면 다른 교시까지 결석으로 만들지 않는다", () => {
    const { plan, ctx } = wholeAbsenceFixture();
    ctx.attendance.pop();
    expect(planAttendanceMigration(plan, ctx).moves.some((m) => m.absenceDay)).toBe(false);
  });
  it("현재는 결석이어도 이전 출석 정정 이력이 있으면 합치지 않는다", () => {
    const { plan, ctx } = wholeAbsenceFixture();
    const revision = structuredClone(ctx.attendance[0]!);
    revision.id = "revision";
    revision.record.id = "revision";
    revision.record.status = "present";
    ctx.attendance.push(revision);
    expect(planAttendanceMigration(plan, ctx).moves.some((m) => m.absenceDay)).toBe(false);
  });
  it("같은 교시의 결석 정정 이력은 묶어 보존하고 다른 교시의 정정 참조는 막는다", () => {
    const { plan, ctx } = wholeAbsenceFixture();
    const revision = structuredClone(ctx.attendance[0]!);
    revision.id = "revision";
    revision.record.id = "revision";
    revision.record.supersedes_id = "a0";
    ctx.attendance.push(revision);
    const r = planAttendanceMigration(plan, ctx);
    expect(r.moves.find((m) => m.ids.includes("a0"))?.ids).toContain("revision");
    expect(r.moves.flatMap((m) => m.ids)).toHaveLength(4);
    revision.record.supersedes_id = "a1";
    expect(planAttendanceMigration(plan, ctx).moves.some((m) => m.absenceDay)).toBe(false);
  });
  it.each(["old", "c1"])("%s 반에 연결된 보고서/예약이 있으면 막는다", (classId) => {
    const { plan, ctx } = wholeAbsenceFixture();
    ctx.attendanceLinks.push({ classId, studentId: "s1", date: "2026-10-01", kind: "report" });
    expect(planAttendanceMigration(plan, ctx).moves).toEqual([]);
  });
  it.each(["17:20", null, "22:00"])("새 반의 기존 %s 기록과 섞지 않는다", (startTime) => {
    const { plan, ctx } = wholeAbsenceFixture();
    ctx.attendance.push({ ...ctx.attendance[0]!, id: "occupied", classId: "c1", startTime });
    const result = planAttendanceMigration(plan, ctx);
    expect(result.moves.some((m) => m.absenceDay)).toBe(false);
    expect(result.issues.some((i) => i.severity === "error")).toBe(true);
  });
  it("새 교시가 더 많거나 당일 수업이 없거나 배치가 중복되면 추정하지 않는다", () => {
    for (const mode of ["extra", "missing", "duplicate"]) {
      const { plan, ctx } = wholeAbsenceFixture();
      if (mode === "missing") ctx.schedules = ctx.schedules.filter((s) => s.classId !== "c1");
      else {
        ctx.schedules.push({
          ...ctx.schedules[3]!,
          id: "extra",
          startTime: mode === "extra" ? "21:00" : "17:20",
          teacherId: "t2",
        });
        if (mode === "extra")
          ctx.schedules.push({ ...ctx.schedules[3]!, id: "extra2", startTime: "22:00" });
      }
      expect(planAttendanceMigration(plan, ctx).moves.some((m) => m.absenceDay)).toBe(false);
    }
  });
  it("적용일 전 결석과 다른 반 결석은 이관하지 않는다", () => {
    const { plan, ctx } = wholeAbsenceFixture();
    plan.effectiveDate = "2026-10-02";
    expect(planAttendanceMigration(plan, ctx).moves).toEqual([]);
  });
});
