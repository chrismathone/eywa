import { describe, it, expect } from "vitest";
import { planBulkAttendance, planBulkStatus, countStatusOverwrites, type BulkRosterRow } from "./bulk";

const roster: BulkRosterRow[] = [
  { studentId: "a", eligible: true, historical: false },
  { studentId: "b", eligible: true, historical: false },
  { studentId: "c", eligible: true, historical: true }, // 기록 전용(읽기)
  { studentId: "d", eligible: false, historical: false }, // 수강 대상 아님
];

const DATE = "2026-07-29";
const SLOT = "16:20";

describe("planBulkAttendance", () => {
  it("기록 없는 학생만 — 이미 기록된 학생은 건드리지 않는다(비파괴)", () => {
    const attendance = { [`a|${DATE}`]: "absent" };
    expect(planBulkAttendance(roster, attendance, DATE, { canEdit: true, canMarkDate: true })).toEqual(["b"]);
  });

  it("🔴 빈 행을 채우는 기능이므로 '기록이 있어야 통과'하는 게이트가 없다 — 전원 미기록이면 전원 대상", () => {
    expect(planBulkAttendance(roster, {}, DATE, { canEdit: true, canMarkDate: true })).toEqual(["a", "b"]);
  });

  it("읽기 전용 행(historical)·비수강 행은 제외", () => {
    const ids = planBulkAttendance(roster, {}, DATE, { canEdit: true, canMarkDate: true });
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("d");
  });

  it("편집 권한 없거나 출결 수정 기간이 지나면 0건", () => {
    expect(planBulkAttendance(roster, {}, DATE, { canEdit: false, canMarkDate: true })).toEqual([]);
    expect(planBulkAttendance(roster, {}, DATE, { canEdit: true, canMarkDate: false })).toEqual([]);
  });
});

describe("planBulkStatus", () => {
  const marks = { [`a|${DATE}|${SLOT}`]: { status: "완", progressNote: null } };

  it("onlyEmpty=true면 값이 있는 행을 건너뛴다", () => {
    expect(planBulkStatus(roster, marks, DATE, SLOT, { canEdit: true, onlyEmpty: true })).toEqual(["b"]);
  });

  it("onlyEmpty=false면 편집 가능한 행 전체(덮어쓰기)", () => {
    expect(planBulkStatus(roster, marks, DATE, SLOT, { canEdit: true, onlyEmpty: false })).toEqual(["a", "b"]);
  });

  it("빈 문자열도 '비어 있음'으로 본다", () => {
    const withEmpty = { [`a|${DATE}|${SLOT}`]: { status: "", progressNote: null } };
    expect(planBulkStatus(roster, withEmpty, DATE, SLOT, { canEdit: true, onlyEmpty: true })).toEqual(["a", "b"]);
  });

  it("편집 권한이 없으면 0건", () => {
    expect(planBulkStatus(roster, marks, DATE, SLOT, { canEdit: false, onlyEmpty: false })).toEqual([]);
  });
});

describe("countStatusOverwrites", () => {
  it("덮어쓰기로 사라질 값의 수를 센다(확인 문구용)", () => {
    const marks = {
      [`a|${DATE}|${SLOT}`]: { status: "완", progressNote: null },
      [`b|${DATE}|${SLOT}`]: { status: null, progressNote: "메모" },
      [`c|${DATE}|${SLOT}`]: { status: "결석", progressNote: null }, // historical → 대상 아님
    };
    expect(countStatusOverwrites(roster, marks, DATE, SLOT, true)).toBe(1);
  });
});
