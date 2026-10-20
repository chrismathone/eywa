import { describe, expect, it } from "vitest";
import { buildParentMonth, listParentMonthChanges, summarizeParentMonth, type MonthInput } from "./parent-month";

const base: MonthInput = {
  month: "2026-10",
  today: "2026-10-07",
  holidays: { "2026-10-09": "한글날" },
  regular: [
    { direction: "in", weekdays: ["mon", "tue", "wed", "thu", "fri"], runStopId: "S-in" },
    { direction: "out", weekdays: ["mon", "tue", "wed", "thu", "fri"], runStopId: "S-out" },
  ],
  exceptions: [],
  boardings: [],
};
const day = (input: MonthInput, date: string) => buildParentMonth(input).flat().find((d) => d.date === date)!;

describe("buildParentMonth — 학부모 월별 달력", () => {
  it("평일 5칸만, 이번 달 평일이 없는 주는 뺀다", () => {
    const weeks = buildParentMonth(base);
    expect(weeks.every((w) => w.length === 5)).toBe(true);
    expect(weeks[0]!.some((d) => d.inMonth)).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth).map((d) => d.date)).not.toContain("2026-10-03"); // 토요일
  });

  it("지난 날은 탑승 기록(탔음·미탑승)이 칸을 채운다", () => {
    const input = { ...base, boardings: [
      { date: "2026-10-06", direction: "in" as const, status: "boarded" as const },
      { date: "2026-10-06", direction: "out" as const, status: "missed" as const },
    ] };
    expect(day(input, "2026-10-06")).toMatchObject({ in: "rode", out: "missed" });
  });

  it("앞으로의 날은 바뀐 날만 — 평소대로면 비고, 미래 날짜의 탑승 기록은 믿지 않는다", () => {
    const input = { ...base,
      boardings: [{ date: "2026-10-14", direction: "in" as const, status: "boarded" as const }],
      exceptions: [{ onDate: "2026-10-15", direction: "out" as const, kind: "add" as const, runStopId: "S-other", memo: null }],
    };
    expect(day(input, "2026-10-14")).toMatchObject({ in: null, out: null });
    expect(day(input, "2026-10-15")).toMatchObject({ in: null, out: "changed" });
  });

  it("평소 자리를 가리키는 '여기서 탐'은 변경이 아니다", () => {
    const input = { ...base, exceptions: [{ onDate: "2026-10-15", direction: "in" as const, kind: "add" as const, runStopId: "S-in", memo: null }] };
    expect(day(input, "2026-10-15").in).toBeNull();
  });

  it("결석은 두 방향을 한 번에 — 한 방향만 안 타면 '안 탐'", () => {
    const input = { ...base, exceptions: [
      { onDate: "2026-10-16", direction: "in" as const, kind: "skip" as const, runStopId: null, memo: "결석 · 감기" },
      { onDate: "2026-10-16", direction: "out" as const, kind: "skip" as const, runStopId: null, memo: "결석 · 감기" },
      { onDate: "2026-10-19", direction: "out" as const, kind: "skip" as const, runStopId: null, memo: "병원" },
    ] };
    expect(day(input, "2026-10-16").absent).toBe(true);
    expect(day(input, "2026-10-19")).toMatchObject({ absent: false, in: null, out: "skip" });
    const s = summarizeParentMonth(buildParentMonth(input));
    expect(s).toMatchObject({ absentDays: 1, skipDays: 1 });
  });

  it("휴일은 표시 없이 이름만", () => {
    const input = { ...base, exceptions: [{ onDate: "2026-10-09", direction: "in" as const, kind: "skip" as const, runStopId: null, memo: "x" }] };
    expect(day(input, "2026-10-09")).toMatchObject({ holiday: "한글날", in: null, out: null });
  });

  it("법정공휴일도 쉬는 날 — 학원설정에 없어도 이름만, 표시 없음(학원이 붙인 이름이 먼저)", () => {
    const input = { ...base, holidays: { "2026-10-09": "한글날 휴원" },
      today: "2026-10-31",
      boardings: [{ date: "2026-10-05", direction: "in" as const, status: "boarded" as const }],
      exceptions: [{ onDate: "2026-10-05", direction: "out" as const, kind: "add" as const, runStopId: "S-x", memo: null }],
    };
    expect(day(input, "2026-10-05")).toMatchObject({ holiday: "대체공휴일", in: null, out: null });
    expect(day(input, "2026-10-09").holiday).toBe("한글날 휴원");
    expect(day(input, "2026-10-08").holiday).toBeNull();
    expect(listParentMonthChanges(input, buildParentMonth(input))).toEqual([]);
  });

  it("변경 목록 — 날짜 순, 결석은 하루 한 줄, 사유는 싣지 않는다", () => {
    const input = { ...base, exceptions: [
      { onDate: "2026-10-20", direction: "out" as const, kind: "add" as const, runStopId: "S-x", memo: null, label: "1호차 2회차 · 칠성초 정문 18:20" },
      { onDate: "2026-10-16", direction: "in" as const, kind: "skip" as const, runStopId: null, memo: "결석 · 감기" },
      { onDate: "2026-10-16", direction: "out" as const, kind: "skip" as const, runStopId: null, memo: "결석 · 감기" },
    ] };
    const list = listParentMonthChanges(input, buildParentMonth(input));
    expect(list).toEqual([
      { date: "2026-10-16", direction: "in", kind: "absent", label: null },
      { date: "2026-10-20", direction: "out", kind: "changed", label: "1호차 2회차 · 칠성초 정문 18:20" },
    ]);
  });
});
