import { describe, it, expect } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import {
  buildWeekGrid,
  buildSubjectPeriodGrid,
  weekCellKey,
  type WeekGridRow,
} from "./week-grid";

const row = (
  classId: string,
  subject: string,
  className: string,
  teacherName: string | null,
  slots: WeekGridRow["slots"],
): WeekGridRow => ({ classId, subject, className, teacherName, slots });

const mathRow = (classId: string, className: string, slots: WeekGridRow["slots"]) =>
  row(classId, "math", className, "김샘", slots);

const cfg = DEFAULT_PERIODS_CONFIG; // 평일=MATH_PERIODS(8교시), 주말=09:00~ 8교시

describe("buildWeekGrid (시각축 · 전체 탭)", () => {
  it("빈 입력 → 빈 격자", () => {
    const g = buildWeekGrid([]);
    expect(g.days).toEqual([]);
    expect(g.times).toEqual([]);
    expect(g.cells.size).toBe(0);
  });

  it("등장한 요일만 월→일 순(입력 순서 무관)", () => {
    const g = buildWeekGrid([
      row("c1", "english", "E반", "Anna", [
        { day: "fri", startTime: "16:00", periodLabel: "3교시" },
        { day: "mon", startTime: "16:00", periodLabel: "3교시" },
        { day: "wed", startTime: "16:00", periodLabel: "3교시" },
      ]),
    ]);
    expect(g.days).toEqual(["mon", "wed", "fri"]);
  });

  it("시각은 오름차순·중복 제거", () => {
    const g = buildWeekGrid([
      mathRow("c1", "M반", [
        { day: "mon", startTime: "09:00", periodLabel: "1교시" },
        { day: "mon", startTime: "14:20", periodLabel: "5교시" },
      ]),
      row("c2", "english", "E반", "Anna", [{ day: "mon", startTime: "09:00", periodLabel: "1교시" }]),
    ]);
    expect(g.times).toEqual(["09:00", "14:20"]);
  });

  it("같은 (요일,시각)에 다른 과목·강사 → 한 셀에 두 항목", () => {
    const g = buildWeekGrid([
      mathRow("c1", "수학심화", [{ day: "tue", startTime: "18:00", periodLabel: "6교시" }]),
      row("c2", "english", "영어리딩", "Anna", [{ day: "tue", startTime: "18:00", periodLabel: "4교시" }]),
    ]);
    const cell = g.cells.get(weekCellKey("tue", "18:00"));
    expect(cell).toHaveLength(2);
    expect(cell!.map((c) => c.teacherName).sort()).toEqual(["Anna", "김샘"]);
  });
});

describe("buildSubjectPeriodGrid (교시축 · 과목 탭)", () => {
  it("평일 단일 수업 → 그 과목 교시행 전체 + 해당 교시 셀", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }])],
      "math",
      false,
      cfg,
    );
    expect(g.days).toEqual(["mon"]);
    expect(g.rows.length).toBe(8); // MATH 8교시 전체(빈 교시 포함)
    const p3 = g.rows.findIndex((r) => r.key === "p-3"); // 16:20 = 3교시
    expect(p3).toBeGreaterThanOrEqual(0);
    expect(g.cellAt(p3, 0)?.className).toBe("수학A");
    expect(g.blocks.get(`${p3}:0`)).toEqual({ rowSpan: 1, colSpan: 1 });
  });

  it("같은 반 연속 교시 → 세로 rowSpan 병합", () => {
    const g = buildSubjectPeriodGrid(
      [
        mathRow("c1", "수학A", [
          { day: "mon", startTime: "18:20", periodLabel: "5교시" },
          { day: "mon", startTime: "19:15", periodLabel: "6교시" },
        ]),
      ],
      "math",
      false,
      cfg,
    );
    const p5 = g.rows.findIndex((r) => r.key === "p-5");
    const p6 = g.rows.findIndex((r) => r.key === "p-6");
    expect(g.blocks.get(`${p5}:0`)).toEqual({ rowSpan: 2, colSpan: 1 });
    expect(g.blocks.get(`${p6}:0`)).toBeUndefined(); // 위 블록에 피복
    expect(g.cellAt(p5, 0)?.classId).toBe("c1");
  });

  it("다른 반 연속 교시 → 병합 안 함(각자 1칸)", () => {
    const g = buildSubjectPeriodGrid(
      [
        mathRow("c1", "A", [{ day: "mon", startTime: "18:20", periodLabel: "5교시" }]),
        mathRow("c2", "B", [{ day: "mon", startTime: "19:15", periodLabel: "6교시" }]),
      ],
      "math",
      false,
      cfg,
    );
    const p5 = g.rows.findIndex((r) => r.key === "p-5");
    const p6 = g.rows.findIndex((r) => r.key === "p-6");
    expect(g.blocks.get(`${p5}:0`)).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(g.blocks.get(`${p6}:0`)).toEqual({ rowSpan: 1, colSpan: 1 });
  });

  it("다른 과목 행은 무시(과목 필터)", () => {
    const g = buildSubjectPeriodGrid(
      [
        mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }]),
        row("c2", "english", "영어B", "Anna", [{ day: "mon", startTime: "16:20", periodLabel: "4교시" }]),
      ],
      "math",
      false,
      cfg,
    );
    const p3 = g.rows.findIndex((r) => r.key === "p-3");
    expect(g.cellAt(p3, 0)?.subject).toBe("math");
    expect(g.days).toEqual(["mon"]);
  });

  it("평일/주말 슬롯 분리 — weekend=false면 주말 슬롯 제외, true면 주말만", () => {
    const rows = [mathRow("c1", "A", [{ day: "sat", startTime: "09:00", periodLabel: "1교시" }])];
    expect(buildSubjectPeriodGrid(rows, "math", false, cfg).days).toEqual([]);
    const wk = buildSubjectPeriodGrid(rows, "math", true, cfg);
    expect(wk.days).toEqual(["sat"]);
    const p1 = wk.rows.findIndex((r) => r.key === "p-1"); // 주말 09:00 = 1교시
    expect(wk.cellAt(p1, 0)?.className).toBe("A");
  });

  it("표준 교시에 안 맞는 시각 → 폴백(x-시각) 행 추가", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "A", [{ day: "mon", startTime: "16:00", periodLabel: "16:00" }])],
      "math",
      false,
      cfg,
    );
    expect(g.rows.some((r) => r.key === "x-16:00")).toBe(true);
    const xi = g.rows.findIndex((r) => r.key === "x-16:00");
    expect(g.cellAt(xi, 0)?.className).toBe("A");
  });
});
