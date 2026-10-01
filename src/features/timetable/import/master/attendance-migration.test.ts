import { describe, expect, it } from "vitest";
import { attendanceFixture, record } from "./attendance-test-fixture";
import { planAttendanceMigration } from "./attendance-migration";

describe("시트 반이동의 기존 출결", () => {
  it("적용일 이후 LAB 출결도 새 반의 확정된 일반 교시로 이관한다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.schedules = ctx.schedules.filter((s) => s.classId !== "old");
    ctx.attendance[0]!.record.seat_label = "LAB";
    const r = planAttendanceMigration(plan, ctx);
    expect(r.issues.map((i) => i.severity)).toEqual(["confirm"]);
    expect(r.moves[0]?.seatChange).toEqual({ from: "LAB", to: null });
  });
  it("시각이 바뀌었고 같은 강사 교시가 여러 개면 자동 선택하지 않는다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.schedules[1]!.startTime = "15:00";
    ctx.schedules.push({
      ...ctx.schedules[1]!,
      id: "second",
      startTime: "15:40",
      endTime: "16:20",
    });
    expect(planAttendanceMigration(plan, ctx).issues[0]?.reason).toContain(
      "하나로 확정하지 못했습니다",
    );
  });
  it("적용일부터 같은 교시로 정정 이력을 함께 옮기고 과거 기록은 유지한다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.attendance.push(
      record("revision", {
        record: {
          ...record().record,
          id: "revision",
          status: "late",
          supersedes_id: "a",
        },
      }),
      record("past", { date: "2026-09-30" }),
    );
    const before = structuredClone(ctx);
    const result = planAttendanceMigration(plan, ctx);
    expect(result.moves).toMatchObject([
      {
        ids: ["a", "revision"],
        fromClassId: "old",
        toClassId: "c1",
        toTime: "14:20",
      },
    ]);
    expect(result.issues.map((i) => i.severity)).toEqual(["confirm"]);
    expect(ctx).toEqual(before);
  });
  it("새 반에서 강사가 같은 유일한 교시로 시각을 이동한다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.schedules[1]!.startTime = "15:00";
    expect(planAttendanceMigration(plan, ctx).moves[0]?.toTime).toBe("15:00");
  });
  it("서로 다른 교시를 한 칸으로 합치지 않는다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.schedules.push({
      ...ctx.schedules[0]!,
      id: "second",
      startTime: "15:00",
      endTime: "15:40",
    });
    ctx.attendance.push(record("second", { startTime: "15:00" }));
    const result = planAttendanceMigration(plan, ctx);
    expect(result.moves).toEqual([]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.reason).toContain("합쳐질");
  });
  it.each(["14:20", null])(
    "새 반에 이미 있는 %s 출결은 덮어쓰지 않는다",
    (startTime) => {
      const { plan, ctx } = attendanceFixture();
      ctx.attendance.push(record("occupied", { classId: "c1", startTime }));
      const result = planAttendanceMigration(plan, ctx);
      expect(result.moves).toEqual([]);
      expect(result.issues[0]?.reason).toContain("이미 있습니다");
    },
  );
  it("날짜 전체 출결은 날짜 전체로 옮긴다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.attendance[0]!.startTime = null;
    expect(planAttendanceMigration(plan, ctx).moves[0]?.toTime).toBeNull();
  });
  it.each(["report", "reservation"])(
    "연결된 %s는 출결만 따로 옮기지 않는다",
    (kind) => {
      const { plan, ctx } = attendanceFixture();
      ctx.attendanceLinks = [
        { classId: "old", studentId: "s1", date: "2026-10-01", kind },
      ];
      expect(planAttendanceMigration(plan, ctx).issues[0]?.reason).toContain(
        "수업보고서 또는 보강",
      );
    },
  );
  it("새 반의 날짜·교시가 없으면 구체적인 이유로 막는다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.schedules[1]!.day = "fri";
    expect(planAttendanceMigration(plan, ctx).issues[0]?.reason).toContain(
      "해당 날짜",
    );
  });
  it("일반 교시에서 LAB으로 바뀌면 새 자리 구분을 이관 계획에 포함한다", () => {
    const { plan, ctx } = attendanceFixture();
    ctx.schedules[1]!.slotTeacherLabel = "LAB";
    expect(planAttendanceMigration(plan, ctx).moves[0]?.seatChange).toEqual({ from: "일반 수업", to: "LAB" });
  });
  it("같은 교시의 강사·강의실 변경은 기존 출결을 유지한다", () => {
    const { plan, ctx } = attendanceFixture();
    plan.roster.moves = [];
    plan.report.planItems = [
      {
        action: "update",
        scheduleId: "slot",
        classId: "old",
        className: "이전반",
        day: "thu",
        startTime: "14:20",
        endTime: "15:00",
        teacherId: "t2",
        teacherNames: ["Green"],
        classroomId: "r2",
        room: "606",
      },
    ];
    const result = planAttendanceMigration(plan, ctx);
    expect(result).toEqual({ moves: [], retainedCells: 1, issues: [] });
  });
  it("다른 요일 수정은 출결을 건드리지 않는다", () => {
    const { plan, ctx } = attendanceFixture();
    plan.roster.moves = [];
    plan.report.planItems = [
      {
        action: "remove",
        scheduleId: "slot",
        classId: "old",
        className: "이전반",
        day: "mon",
        startTime: "14:20",
        endTime: "15:00",
        teacherNames: [],
        room: "",
      },
    ];
    expect(planAttendanceMigration(plan, ctx).issues).toEqual([]);
  });
});
