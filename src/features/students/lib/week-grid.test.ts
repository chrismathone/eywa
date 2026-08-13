import { describe, it, expect } from "vitest";
import { DEFAULT_PERIODS_CONFIG, settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { buildSubjectPeriodGrid, type WeekGridRow } from "./week-grid";

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

  it("슬롯 강의실(room)이 셀에 전달됨 (slot_room_label ?? 반 기본)", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시", room: "201호" }])],
      "math",
      false,
      cfg,
    );
    const p3 = g.rows.findIndex((r) => r.key === "p-3");
    expect(g.cellAt(p3, 0)?.room).toBe("201호");
  });

  it("강의실 없는 슬롯 → room null", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }])],
      "math",
      false,
      cfg,
    );
    const p3 = g.rows.findIndex((r) => r.key === "p-3");
    expect(g.cellAt(p3, 0)?.room).toBeNull();
  });

  it("영어(11교시) 행 수 — 과목별 교시표 반영", () => {
    const g = buildSubjectPeriodGrid(
      [row("c1", "english", "E반", "Anna", [{ day: "mon", startTime: "14:20", periodLabel: "1교시" }])],
      "english",
      false,
      cfg,
    );
    expect(g.rows.length).toBe(11); // ENGLISH_PERIODS 11교시
  });

  // 교시 이름은 **학원설정이 단일 소스**다(코드가 `N교시`를 지어내지 않는다, 2026-08-13).
  // 비운 이름은 빈 문자열로 내려오고 그 자리엔 화면이 시간대를 그린다(student-period-grid).
  it("교시 이름 = 설정값 · 비우면 빈 문자열(내장표만 `N교시`)", () => {
    const named = settingsToPeriodsConfig({
      weekdayPeriods: [{ label: "1교시", startTime: "14:30", endTime: "15:25" }],
      weekendPeriods: [{ label: "1교시", startTime: "09:00", endTime: "10:00" }],
      subjects: [
        {
          key: "english",
          weekdayPeriods: [
            { label: "EiE 1교시", startTime: "14:20", endTime: "15:00" },
            { label: "", startTime: "15:00", endTime: "15:40" },
          ],
        },
      ],
    });
    const g = buildSubjectPeriodGrid(
      [row("c1", "english", "E반", "Anna", [{ day: "mon", startTime: "14:20", periodLabel: "EiE 1교시" }])],
      "english",
      false,
      named,
    );
    expect(g.rows.map((r) => r.label)).toEqual(["EiE 1교시", ""]);
    expect(g.rows.map((r) => r.time)).toEqual(["14:20~15:00", "15:00~15:40"]);
    // 내장표(설정 없음)는 종전대로 번호.
    const builtin = buildSubjectPeriodGrid(
      [row("c1", "english", "E반", "Anna", [{ day: "mon", startTime: "14:20", periodLabel: "1교시" }])],
      "english",
      false,
      cfg,
    );
    expect(builtin.rows[0]!.label).toBe("1교시");
  });
});
