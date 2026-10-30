import { describe, expect, it } from "vitest";
import { changeText, homeroomRate, homeroomTrendRows, mondayOf, recentWeekTrend } from "./stats-recent";
import type { HomeroomStats } from "./homeroom-model";
import type { StatsBucket } from "./stats-model";

const wk = (b: string, n: number): StatsBucket => ({ b, n, students: 0, done: 0, pending: 0, audio: 0, ai: 0, synced: 0, mapped: 0 });

describe("상담 최근 추세", () => {
  it("월요일 — 일요일은 앞 주 월요일, 월요일은 그대로", () => {
    expect(mondayOf("2026-10-30")).toBe("2026-10-26"); // 금
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // 일
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });

  it("다 끝난 최근 4주 vs 앞 4주 · 이번 주는 따로 · 빠진 주는 0건", () => {
    const weeks = [
      wk("2026-08-24", 99), // 8주보다 앞 — 안 센다
      wk("2026-08-31", 10), wk("2026-09-07", 10), wk("2026-09-14", 10), wk("2026-09-21", 10), // 앞 4주 = 40
      // 최근 4주 = 9/28 · 10/5 · 10/12 · 10/19 주(9/28 주는 버킷 없음)
      wk("2026-10-05", 20), wk("2026-10-12", 0), wk("2026-10-19", 30), // = 50
      wk("2026-10-26", 7), // 이번 주
    ];
    const t = recentWeekTrend(weeks, "2026-10-30");
    expect(t).toEqual({ recent: 50, prior: 40, thisWeek: 7, changePct: 25, from: "2026-09-28", to: "2026-10-25" });
  });

  it("앞 4주가 0이면 증감은 없다", () => {
    expect(recentWeekTrend([wk("2026-10-19", 3)], "2026-10-30").changePct).toBeNull();
    expect(changeText(null)).toBeNull();
    expect(changeText(0)).toBe("변화 없음");
    expect(changeText(12)).toBe("+12%");
    expect(changeText(-5)).toBe("-5%");
  });
});

describe("담임별 달 요약", () => {
  const stu = (selfCounts: number[]) => ({ id: "s", name: "학생", grade: null, cells: [], selfCounts, lastSelf: null, otherNames: [] });
  const data = (months: string[], teachers: { id: string; m: { target: number; self: number }[]; counts: number[][] }[]): HomeroomStats => ({
    today: "2026-11-10",
    months,
    prevMonth: months.at(-2) ?? months[0]!,
    retired: { teachers: 0, classes: 0, students: 0 },
    teachers: teachers.map((t) => ({
      id: t.id, name: t.id, subjects: ["math"], classNames: [], prev: { students: 0, withdrawn: [] },
      months: t.m.map((x) => ({ ...x, other: 0, none: x.target - x.self })),
      students: t.counts.map(stu),
    })),
  });

  it("끝 두 달만 · 건수는 담임 본인 상담 합(같은 학생 여러 번 포함)", () => {
    const { months, rows } = homeroomTrendRows(data(["2026-09", "2026-10", "2026-11"], [
      { id: "A", m: [{ target: 9, self: 9 }, { target: 10, self: 5 }, { target: 10, self: 2 }], counts: [[1, 3, 1], [0, 2, 1]] },
    ]));
    expect(months).toEqual(["2026-10", "2026-11"]);
    expect(rows[0]!.months).toEqual([
      { ym: "2026-10", counseled: 5, target: 10, count: 5 },
      { ym: "2026-11", counseled: 2, target: 10, count: 2 },
    ]);
  });

  it("대상이 모든 달 0인 담임 줄은 빼고 · 반에 들어오기 전(before) 달 상담은 건수에서 뺀다", () => {
    const d = data(["2026-10", "2026-11"], [
      { id: "A", m: [{ target: 2, self: 1 }, { target: 2, self: 1 }], counts: [[2, 1], [1, 4]] },
      { id: "Z", m: [{ target: 0, self: 0 }, { target: 0, self: 0 }], counts: [] },
    ]);
    d.teachers[0]!.students[1]!.cells = ["before", "self"];
    const { rows } = homeroomTrendRows(d);
    expect(rows.map((r) => r.id)).toEqual(["A"]);
    expect(rows[0]!.months.map((m) => m.count)).toEqual([2, 5]);
  });

  it("학원 합계 상담률 — 한 달뿐이면 지난달 없음 · 대상 0이면 없음", () => {
    const two = homeroomTrendRows(data(["2026-10", "2026-11"], [
      { id: "A", m: [{ target: 10, self: 5 }, { target: 10, self: 2 }], counts: [] },
      { id: "B", m: [{ target: 10, self: 10 }, { target: 10, self: 4 }], counts: [] },
    ])).rows;
    expect(homeroomRate(two)).toEqual({ now: 30, prev: 75 });
    const one = homeroomTrendRows(data(["2026-10"], [{ id: "A", m: [{ target: 4, self: 1 }], counts: [] }])).rows;
    expect(homeroomRate(one)).toEqual({ now: 25, prev: null });
    expect(homeroomRate([])).toEqual({ now: null, prev: null });
  });
});
