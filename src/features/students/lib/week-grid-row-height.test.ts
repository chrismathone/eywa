import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import { buildSubjectPeriodGrid, type PeriodCell, type WeekGridRow } from "./week-grid";
import {
  cellBlockHeight,
  estimateWrapLines,
  labelBlockHeight,
  periodRowHeightsForGrid,
  sumSpan,
  tableContentHeight,
} from "./week-grid-row-height";

const cell = (over: Partial<PeriodCell> = {}): PeriodCell => ({
  classId: "c1",
  className: "PL1a",
  teacherName: "육소희",
  subject: "english",
  room: "본원602",
  seat: null,
  startTime: "14:20",
  endTime: "15:00",
  ...over,
});

const eng = (
  className: string,
  slots: WeekGridRow["slots"],
  extra: Partial<WeekGridRow> = {},
): WeekGridRow => ({
  classId: extra.classId ?? "c1",
  subject: "english",
  className,
  teacherName: extra.teacherName ?? "육소희",
  slots,
});

describe("estimateWrapLines", () => {
  it("짧은 반 이름·강의실은 한 줄", () => {
    expect(estimateWrapLines("PL1a")).toBe(1);
    expect(estimateWrapLines("본원602")).toBe(1);
    expect(estimateWrapLines("KRISTINE")).toBe(1);
  });

  it("칸 폭을 넘는 한글 반 이름은 두 줄 이상", () => {
    expect(estimateWrapLines("중등E_초등 브릿지 C2")).toBeGreaterThan(1);
  });
});

describe("cellBlockHeight — 세 줄이 옛 46px를 넘는다", () => {
  it("반+담당+방(신지민 영어 칸) ≥ 80", () => {
    expect(cellBlockHeight(cell())).toBeGreaterThanOrEqual(80);
    expect(cellBlockHeight(cell())).toBeGreaterThan(46);
  });

  it("자리 알약 칸이 담당 이름 칸보다 작지 않다", () => {
    const seat = cellBlockHeight(cell({ seat: "LAB", teacherName: null }));
    const teacher = cellBlockHeight(cell());
    expect(seat).toBeGreaterThanOrEqual(teacher);
  });

  it("반 이름만이면 세 줄보다 낮다", () => {
    expect(cellBlockHeight(cell({ teacherName: null, room: null, seat: null }))).toBeLessThan(
      cellBlockHeight(cell()),
    );
  });
});

describe("periodRowHeightsForGrid", () => {
  it("영어 40분 3교시 · 칸마다 반+담당+방 → 각 행이 세 줄을 담는다", () => {
    const g = buildSubjectPeriodGrid(
      [
        eng("PL1a", [
          { day: "mon", startTime: "14:20", endTime: "15:00", periodLabel: "", room: "본원602", teacherName: "육소희" },
          { day: "mon", startTime: "15:00", endTime: "15:40", periodLabel: "", room: "본원602", seat: "LAB" },
          { day: "mon", startTime: "15:40", endTime: "16:20", periodLabel: "", room: "본원603" },
        ]),
      ],
      "english",
      false,
      DEFAULT_PERIODS_CONFIG,
      "used",
    );
    expect(g.rows).toHaveLength(3);
    const heights = periodRowHeightsForGrid(g);
    expect(heights).toHaveLength(3);
    const need = cellBlockHeight(cell());
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(need);
  });

  it("연속 교시 병합 칸은 높이를 나눠 갖고 합은 칸 높이 이상", () => {
    const g = buildSubjectPeriodGrid(
      [
        {
          classId: "c1",
          subject: "math",
          className: "수학A",
          teacherName: "김샘",
          slots: [
            { day: "mon", startTime: "18:20", endTime: "19:15", periodLabel: "5교시", room: "201" },
            { day: "mon", startTime: "19:15", endTime: "20:10", periodLabel: "6교시", room: "201" },
          ],
        },
      ],
      "math",
      false,
      DEFAULT_PERIODS_CONFIG,
    );
    const p5 = g.rows.findIndex((r) => r.key === "p-5");
    expect(g.blocks.get(`${p5}:0`)?.rowSpan).toBe(2);
    const heights = periodRowHeightsForGrid(g);
    const merged = g.cellAt(p5, 0)!;
    expect(sumSpan(heights, p5, 2)).toBeGreaterThanOrEqual(cellBlockHeight(merged));
  });

  it("빈 교시 행은 라벨 높이이고, fillTotal로 줄이지 않는다", () => {
    const g = buildSubjectPeriodGrid(
      [
        {
          classId: "c1",
          subject: "math",
          className: "수학A",
          teacherName: "김샘",
          slots: [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }],
        },
      ],
      "math",
      false,
      DEFAULT_PERIODS_CONFIG,
    );
    const heights = periodRowHeightsForGrid(g);
    const empty = g.rows.findIndex((r) => r.key === "p-1");
    expect(heights[empty]).toBe(labelBlockHeight(g.rows[empty]!));
    const filled = periodRowHeightsForGrid(g, 10);
    expect(filled).toEqual(heights);
    const stretched = periodRowHeightsForGrid(g, tableContentHeight(g) + g.rows.length);
    expect(stretched.reduce((a, b) => a + b, 0)).toBe(tableContentHeight(g) + g.rows.length);
  });
});

describe("🔴 배선 — 격자가 내용 높이를 쓴다", () => {
  const tabs = join(process.cwd(), "src", "app", "(shell)", "students", "[id]", "_tabs");
  const read = (f: string) => readFileSync(join(tabs, f), "utf8");

  it("카드 총높이는 행수×46이 아니라 내용 높이의 최댓값", () => {
    const src = read("student-week-grid.tsx");
    expect(src).not.toMatch(/BASE_ROW_H/);
    expect(src).toMatch(/\.map\(\s*tableContentHeight\s*\)/);
  });

  it("표는 균등 분할 대신 periodRowHeightsForGrid를 쓴다", () => {
    const src = read("student-period-grid.tsx");
    expect(src).not.toMatch(/tableHeight\s*\/\s*Math\.max/);
    expect(src).toMatch(/periodRowHeightsForGrid\(\s*grid,\s*tableHeight\s*\)/);
    expect(src).toMatch(/width:\s*CELL_COL_W/);
  });
});
