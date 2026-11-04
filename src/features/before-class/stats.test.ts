import { describe, expect, it } from "vitest";
import { groupStats, isRecordedDay, totalStat, weekStartOf } from "./stats";

const day = (date: string, missed: string[] = [], absent = false) => ({ date, check: { missed, absent, card: null } });

describe("학생 통계", () => {
  it("기록한 날 = 추적 시작 ~ 오늘", () => {
    expect(isRecordedDay("2026-10-26", "2026-10-28", "2026-10-28")).toBe(false);
    expect(isRecordedDay("2026-10-28", "2026-10-28", "2026-10-28")).toBe(true);
    expect(isRecordedDay("2026-10-29", "2026-10-28", "2026-10-26")).toBe(false);
    expect(isRecordedDay("2026-10-28", "2026-10-28", null)).toBe(false);
  });

  it("주 = 월요일 시작 · 최신 기간 먼저", () => {
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26");
    expect(weekStartOf("2026-10-26")).toBe("2026-10-26");
    const weeks = groupStats([day("2026-10-26"), day("2026-10-29", ["deadline", "materials", "concept_note"]), day("2026-11-02", [], true)], "week");
    expect(weeks.map((w) => w.label)).toEqual(["11/2~11/8", "10/26~11/1"]);
    expect(weeks[1]).toMatchObject({ lessons: 2, supplementCount: 1, absentCount: 0 });
    expect(weeks[1]!.average).toBeCloseTo(0.85);
    expect(weeks[0]).toMatchObject({ lessons: 1, absentCount: 1, average: null });
  });

  it("달 묶음과 항목별 미흡(결석 날은 안 센다)", () => {
    const months = groupStats([day("2026-10-26", ["deadline"]), day("2026-11-02", ["deadline"]), day("2026-11-05", ["deadline"], true)], "month");
    expect(months.map((m) => m.label)).toEqual(["2026년 11월", "2026년 10월"]);
    expect(months[0]!.itemCounts.deadline).toBe(1);
    expect(totalStat([day("2026-10-26", ["deadline"]), day("2026-10-29")]).average).toBeCloseTo(0.95);
  });

  it("카드 = 종류별 개수(결석 날 고른 카드도 센다 · 안 고른 날은 완료율 자동 카드)", () => {
    const t = totalStat([
      { date: "2026-10-26", check: { missed: [], absent: false, card: "blue" as const } },
      { date: "2026-10-29", check: { missed: [], absent: true, card: "blue" as const } },
      { date: "2026-11-02", check: { missed: [], absent: false, card: "none" as const } },
      day("2026-11-05"),
      day("2026-11-06", [], true),
    ]);
    // 11-05 = 100% → 자동 골드 · 11-06 결석·안 고름 → 카드 없음.
    expect(t.cardCounts).toEqual({ blue: 2, gold: 1, red: 0, yellow: 0, none: 1 });
  });
});
