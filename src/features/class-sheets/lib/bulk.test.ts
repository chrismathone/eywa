import { describe, it, expect } from "vitest";
import {
  countPlanCellOverwrites,
  countStatusOverwrites,
  planBulkAttendance,
  planBulkPlanCells,
  planBulkStatus,
  type BulkPlanRow,
  type BulkRosterRow,
} from "./bulk";

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
    const attendance = { [`a|${DATE}|${SLOT}`]: "absent" };
    expect(planBulkAttendance(roster, attendance, DATE, SLOT, { canEdit: true, canMarkDate: true })).toEqual(["b"]);
  });

  it("🔴 빈 행을 채우는 기능이므로 '기록이 있어야 통과'하는 게이트가 없다 — 전원 미기록이면 전원 대상", () => {
    expect(planBulkAttendance(roster, {}, DATE, SLOT, { canEdit: true, canMarkDate: true })).toEqual(["a", "b"]);
  });

  it("읽기 전용 행(historical)·비수강 행은 제외", () => {
    const ids = planBulkAttendance(roster, {}, DATE, SLOT, { canEdit: true, canMarkDate: true });
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("d");
  });

  it("편집 권한 없거나 출결 수정 기간이 지나면 0건", () => {
    expect(planBulkAttendance(roster, {}, DATE, SLOT, { canEdit: false, canMarkDate: true })).toEqual([]);
    expect(planBulkAttendance(roster, {}, DATE, SLOT, { canEdit: true, canMarkDate: false })).toEqual([]);
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

// ── 수업계획(평시/내신) 일괄 ───────────────────────────────────────────────────
describe("planBulkPlanCells / countPlanCellOverwrites", () => {
  const ln = (over: Partial<BulkPlanRow> & { id: string }): BulkPlanRow => ({
    termMode: "regular",
    textbook: null,
    pageRange: null,
    progress: null,
    homework: null,
    ...over,
  });
  const lines: BulkPlanRow[] = [
    ln({ id: "r1", textbook: "Power Voca" }),
    ln({ id: "r2" }),
    ln({ id: "r3", textbook: "   " }), // 공백만 = 빈 칸(plan-codec 저장 규약)
    ln({ id: "e1", termMode: "exam", textbook: "내신 교재" }),
  ];

  it("고른 시기의 줄만 대상 — 평시를 고르면 내신 줄은 안 건드린다", () => {
    expect(planBulkPlanCells(lines, "regular", "textbook", { canEdit: true, onlyEmpty: false })).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(planBulkPlanCells(lines, "exam", "textbook", { canEdit: true, onlyEmpty: false })).toEqual(["e1"]);
  });

  it("onlyEmpty면 그 칸이 빈 줄만(공백만 있는 칸도 빈 칸)", () => {
    expect(planBulkPlanCells(lines, "regular", "textbook", { canEdit: true, onlyEmpty: true })).toEqual([
      "r2",
      "r3",
    ]);
  });

  it("칸마다 따로 판정한다 — 교재가 찬 줄도 '진도'는 비어 있다", () => {
    expect(planBulkPlanCells(lines, "regular", "progress", { canEdit: true, onlyEmpty: true })).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("편집 권한이 없으면 0건", () => {
    expect(planBulkPlanCells(lines, "regular", "textbook", { canEdit: false, onlyEmpty: false })).toEqual([]);
  });

  it("줄이 없으면 0건 — 일괄이 줄을 새로 만들지 않는다(구조 변경은 '+ 줄 추가'만)", () => {
    expect(planBulkPlanCells([], "regular", "textbook", { canEdit: true, onlyEmpty: false })).toEqual([]);
  });

  it("덮어쓰기로 사라질 칸 수를 센다(확인 문구용)", () => {
    expect(countPlanCellOverwrites(lines, "regular", "textbook", true)).toBe(1); // r1만 값이 있다
    expect(countPlanCellOverwrites(lines, "regular", "progress", true)).toBe(0);
    expect(countPlanCellOverwrites(lines, "exam", "textbook", true)).toBe(1);
  });
});
