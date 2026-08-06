import { describe, expect, it } from "vitest";
import {
  addCounts,
  countCells,
  countMarks,
  rateDecimal,
  ratePercent,
  sumCounts,
  type Counted,
} from "./totals";

const cell = (s: string, u: number | null = null) => ({ s, u });

describe("countCells — 화면의 모든 합계가 쓰는 한 식", () => {
  it("기록 없는 칸은 분모에 안 들어간다(빈 칸 ≠ 결석)", () => {
    const c = countCells([cell("present"), null, null]);
    expect(c.recorded).toBe(1);
    expect(ratePercent(c)).toBe(100);
  });

  it("시수는 소비 상태만 더한다 — 결석은 0", () => {
    const c = countCells([cell("present"), cell("absent"), cell("late"), cell("makeup", 2)]);
    expect(c.units).toBe(4); // 1 + 0 + 1 + 2
    expect(c.recorded).toBe(4);
    expect(c.present).toBe(1);
    expect(c.absent).toBe(1);
    expect(c.late).toBe(1);
    expect(c.makeup).toBe(1);
  });

  it("🔴 0.1 단위로 반올림한다 — 1.1을 세 번 더하면 3.3000000000000003", () => {
    expect(countCells([cell("present", 1.1), cell("present", 1.1), cell("present", 1.1)]).units).toBe(3.3);
  });

  it("배수 미입력(null)은 1로 센다", () => {
    expect(countCells([cell("present"), cell("present", 1.5)]).units).toBe(2.5);
  });

  it("기록이 없으면 출석률은 null — 0%가 아니다(아직 아무도 안 찍은 것)", () => {
    const c = countCells([]);
    expect(ratePercent(c)).toBeNull();
    expect(rateDecimal(c)).toBe(0);
  });

  it("모르는 상태(excused 등)는 세되 시수엔 안 넣는다", () => {
    const c = countCells([cell("excused")]);
    expect(c.recorded).toBe(1);
    expect(c.units).toBe(0);
    expect(ratePercent(c)).toBe(0); // 기록은 있는데 출석이 없다 = 진짜 0%
  });
});

describe("countMarks — 서버 첫 렌더(marks/units)와 클라(격자 값)가 같은 숫자", () => {
  it("두 입력 경로가 같은 결과를 낸다", () => {
    const marks = { "2026-07-01": "present", "2026-07-02": "absent", "2026-07-03": "makeup" };
    const units = { "2026-07-03": 2 };
    const fromMarks = countMarks(marks, units);
    const fromCells = countCells([cell("present"), cell("absent"), cell("makeup", 2)]);
    expect(fromMarks).toEqual(fromCells);
  });
});

describe("합산", () => {
  it("addCounts/sumCounts는 항목별로 더하고 시수는 반올림한다", () => {
    const a: Counted = { recorded: 1, present: 1, absent: 0, late: 0, makeup: 0, units: 1.1 };
    const b: Counted = { recorded: 2, present: 1, absent: 1, late: 0, makeup: 0, units: 2.2 };
    expect(addCounts(a, b)).toEqual({ recorded: 3, present: 2, absent: 1, late: 0, makeup: 0, units: 3.3 });
    expect(sumCounts([a, b, a])).toEqual({ recorded: 4, present: 3, absent: 1, late: 0, makeup: 0, units: 4.4 });
  });

  it("빈 목록의 합은 0(EMPTY)", () => {
    expect(sumCounts([])).toEqual({ recorded: 0, present: 0, absent: 0, late: 0, makeup: 0, units: 0 });
  });
});

describe("출석률 자릿수", () => {
  it("행 열은 정수 %, 상단 스탯은 소수 한 자리", () => {
    const c = countCells([cell("present"), cell("present"), cell("absent")]);
    expect(ratePercent(c)).toBe(67);
    expect(rateDecimal(c)).toBe(66.7);
  });
});
