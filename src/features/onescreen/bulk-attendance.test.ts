import { describe, expect, it } from "vitest";
import {
  countMarkableRows,
  describeAttendanceSkips,
  planBulkAttendance,
  type BulkAttRow,
} from "./bulk-attendance";

const row = (over: Partial<BulkAttRow> & { studentId: string }): BulkAttRow => ({
  classId: "c1",
  ...over,
});

describe("planBulkAttendance", () => {
  it("기록이 없는 행에 상태를 찍는다", () => {
    const plan = planBulkAttendance([row({ studentId: "s1" }), row({ studentId: "s2" })], "present", {
      onlyEmpty: false,
    });
    expect(plan.cells).toEqual([
      { studentId: "s1", classId: "c1" },
      { studentId: "s2", classId: "c1" },
    ]);
    expect(plan.overwrite).toBe(0);
  });

  it("🔴 조퇴·공결·보강 raw는 절대 덮지 않는다 (출석부 전용 상태 보존)", () => {
    const rows = [
      row({ studentId: "s1", raw: "early_leave" }),
      row({ studentId: "s2", raw: "excused" }),
      row({ studentId: "s3", raw: "makeup" }),
      row({ studentId: "s4", raw: null }),
    ];
    const plan = planBulkAttendance(rows, "absent", { onlyEmpty: false });
    expect(plan.cells).toEqual([{ studentId: "s4", classId: "c1" }]);
    expect(plan.skippedSpecial).toBe(3);
  });

  it("🔴 반이 없는 행(보강 수동추가·반 모호)은 기록할 자리가 없어 제외", () => {
    const rows = [
      row({ studentId: "s1", classId: null }),
      row({ studentId: "s2", classId: undefined }),
      row({ studentId: "s3", isMakeup: true }),
      row({ studentId: "s4" }),
    ];
    const plan = planBulkAttendance(rows, "present", { onlyEmpty: false });
    expect(plan.cells).toEqual([{ studentId: "s4", classId: "c1" }]);
    expect(plan.skippedNoClass).toBe(3);
  });

  it("이미 같은 상태면 no-op (pill 재클릭과 동일)", () => {
    const plan = planBulkAttendance(
      [row({ studentId: "s1", raw: "present" }), row({ studentId: "s2", raw: "late" })],
      "present",
      { onlyEmpty: false },
    );
    expect(plan.cells).toEqual([{ studentId: "s2", classId: "c1" }]);
    expect(plan.skippedSame).toBe(1);
    expect(plan.overwrite).toBe(1); // s2는 late→present 덮어쓰기
  });

  it("빈 칸만 채우기 = 기록 없는 행만", () => {
    const rows = [row({ studentId: "s1", raw: "late" }), row({ studentId: "s2", raw: null })];
    const onlyEmpty = planBulkAttendance(rows, "present", { onlyEmpty: true });
    expect(onlyEmpty.cells).toEqual([{ studentId: "s2", classId: "c1" }]);
    expect(onlyEmpty.skippedFilled).toBe(1);
    expect(onlyEmpty.overwrite).toBe(0);

    const overwrite = planBulkAttendance(rows, "present", { onlyEmpty: false });
    expect(overwrite.cells).toHaveLength(2);
    expect(overwrite.overwrite).toBe(1);
  });

  it("같은 (학생·반)이 두 행으로 와도 한 번만 — 토스트 숫자가 부풀지 않게", () => {
    const rows = [row({ studentId: "s1" }), row({ studentId: "s1" }), row({ studentId: "s1", classId: "c2" })];
    const plan = planBulkAttendance(rows, "present", { onlyEmpty: false });
    expect(plan.cells).toEqual([
      { studentId: "s1", classId: "c1" },
      { studentId: "s1", classId: "c2" },
    ]);
  });

  it("같은 학생이라도 반이 다르면 각 반에 기록 (출결 원장 키 = 학생·반·날짜)", () => {
    const plan = planBulkAttendance(
      [row({ studentId: "s1", classId: "math" }), row({ studentId: "s1", classId: "eng" })],
      "late",
      { onlyEmpty: false },
    );
    expect(plan.cells).toHaveLength(2);
  });

  it("중복 행의 건너뛴 사유도 한 번만 센다", () => {
    const rows = [row({ studentId: "s1", raw: "excused" }), row({ studentId: "s1", raw: "excused" })];
    expect(planBulkAttendance(rows, "present", { onlyEmpty: false }).skippedSpecial).toBe(1);
  });
});

describe("countMarkableRows", () => {
  it("반이 있고 raw가 3종(또는 미기록)인 행만 센다", () => {
    const rows = [
      row({ studentId: "s1" }),
      row({ studentId: "s2", raw: "late" }),
      row({ studentId: "s3", raw: "excused" }),
      row({ studentId: "s4", classId: null }),
      row({ studentId: "s5", isMakeup: true }),
    ];
    expect(countMarkableRows(rows)).toBe(2);
  });

  it("같은 (학생·반) 중복은 한 번", () => {
    expect(countMarkableRows([row({ studentId: "s1" }), row({ studentId: "s1" })])).toBe(1);
  });
});

describe("describeAttendanceSkips", () => {
  it("사유가 없으면 빈 문자열", () => {
    expect(describeAttendanceSkips(planBulkAttendance([row({ studentId: "s1" })], "present", { onlyEmpty: false }))).toBe(
      "",
    );
  });

  it("사유를 사람 말로 이어 붙인다", () => {
    const plan = planBulkAttendance(
      [row({ studentId: "s1", raw: "present" }), row({ studentId: "s2", raw: "excused" }), row({ studentId: "s3", classId: null })],
      "present",
      { onlyEmpty: false },
    );
    expect(describeAttendanceSkips(plan)).toBe("이미 같은 상태 1 · 조퇴·공결·보강 1 · 반 없음 1");
  });
});
