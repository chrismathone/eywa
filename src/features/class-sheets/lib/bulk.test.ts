import { describe, it, expect } from "vitest";
import {
  countPlanCellOverwrites,
  countStatusOverwrites,
  planBulkAttendance,
  planBulkPlanCells,
  planBulkStatus,
  countDayPlanCellOverwrites,
  countDayStatusOverwrites,
  countDayTargets,
  countDayTermLines,
  planDayBulkAttendance,
  planDayBulkPlanCells,
  planDayBulkStatus,
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

// ── 하루 단위(요일 머리 버튼) ─────────────────────────────────────────────────
describe("하루 단위 일괄", () => {
  const slots = [
    { slotStart: "16:20", roster, lines: [] as BulkPlanRow[], scheduled: true },
    { slotStart: "17:20", roster, lines: [] as BulkPlanRow[], scheduled: true },
    // 시간표에서 사라진 칸 — 개별 셀도 잠겨 있으므로 일괄 대상이 아니다.
    { slotStart: "18:20", roster, lines: [] as BulkPlanRow[], scheduled: false },
  ];

  it("교시별로 빈 칸을 따로 센다 — 4교시엔 찍혔고 5교시엔 안 찍힌 학생이 흔하다", () => {
    const attendance = { [`a|${DATE}|16:20`]: "absent" };
    const targets = planDayBulkAttendance(slots, attendance, DATE, {
      canEdit: true,
      canMarkDate: true,
    });
    expect(targets).toEqual([
      { slotStart: "16:20", studentIds: ["b"] },
      { slotStart: "17:20", studentIds: ["a", "b"] },
    ]);
    // 같은 학생이 두 교시면 2칸 — 찍히는 칸이 곧 일감이라 사람이 기대하는 수.
    expect(countDayTargets(targets)).toBe(3);
  });

  it("시간표에 없는 칸(scheduled=false)은 대상에서 빠진다", () => {
    const targets = planDayBulkAttendance(slots, {}, DATE, { canEdit: true, canMarkDate: true });
    expect(targets.map((t) => t.slotStart)).toEqual(["16:20", "17:20"]);
  });

  it("대상이 0인 교시는 묶음에서 빠진다(빈 저장을 보내지 않는다)", () => {
    const attendance = {
      [`a|${DATE}|16:20`]: "present",
      [`b|${DATE}|16:20`]: "present",
    };
    const targets = planDayBulkAttendance(slots, attendance, DATE, {
      canEdit: true,
      canMarkDate: true,
    });
    expect(targets.map((t) => t.slotStart)).toEqual(["17:20"]);
  });

  it("기간·권한이 없으면 하루치도 0건", () => {
    expect(planDayBulkAttendance(slots, {}, DATE, { canEdit: true, canMarkDate: false })).toEqual([]);
    expect(planDayBulkAttendance(slots, {}, DATE, { canEdit: false, canMarkDate: true })).toEqual([]);
  });

  it("태도 덮어쓰기 개수는 그 날 교시를 통틀어 센다(확인 문구의 숫자)", () => {
    const marks = {
      [`a|${DATE}|16:20`]: { status: "좋음", progressNote: null },
      [`b|${DATE}|17:20`]: { status: "보통", progressNote: null },
    };
    expect(countDayStatusOverwrites(slots, marks, DATE, true)).toBe(2);
    // 빈 칸만 채우기면 이미 값이 있는 칸은 대상에서 빠진다.
    const onlyEmpty = planDayBulkStatus(slots, marks, DATE, { canEdit: true, onlyEmpty: true });
    expect(countDayTargets(onlyEmpty)).toBe(2); // 16:20의 b, 17:20의 a
  });

  it("계획 줄은 교시를 넘어 합친다(줄 id는 유일)", () => {
    const withLines = [
      {
        slotStart: "16:20",
        roster,
        lines: [{ id: "L1", termMode: "regular", textbook: null, pageRange: null, progress: null, homework: null }],
        scheduled: true,
      },
      {
        slotStart: "17:20",
        roster,
        lines: [{ id: "L2", termMode: "regular", textbook: "있음", pageRange: null, progress: null, homework: null }],
        scheduled: true,
      },
    ] as unknown as Parameters<typeof planDayBulkPlanCells>[0];
    expect(countDayTermLines(withLines, "regular", true)).toBe(2);
    expect(planDayBulkPlanCells(withLines, "regular", "textbook", { canEdit: true, onlyEmpty: false })).toEqual([
      "L1",
      "L2",
    ]);
    // 빈 칸만이면 이미 쓴 줄(L2)은 빠진다.
    expect(planDayBulkPlanCells(withLines, "regular", "textbook", { canEdit: true, onlyEmpty: true })).toEqual(["L1"]);
    expect(countDayPlanCellOverwrites(withLines, "regular", "textbook", true)).toBe(1);
  });
});
