import { describe, expect, it } from "vitest";
import { isUntouchedScaledSessions, previousPeriod, suggestFromLastMonth, type LastMonthTerm } from "./last-month-suggestion";

const last = (over: Partial<LastMonthTerm> = {}): LastMonthTerm => ({
  confirmedSessions: 6,
  unitPrice: 21250,
  pricingMode: "per_session",
  quantityBasis: "attendance_units",
  ...over,
});

describe("지난 달 확정 기준 미리 채우기 (원장 2026-09-17)", () => {
  it("한 달 전 — 해를 넘긴다", () => {
    expect(previousPeriod("2026-10")).toBe("2026-09");
    expect(previousPeriod("2027-01")).toBe("2026-12");
  });

  it("지난 달도 예정대로 확정했으면 단가만, 시수는 이번 달 예정 그대로", () => {
    expect(suggestFromLastMonth(9, last({ confirmedSessions: 7 }), 7)).toEqual({ price: 21250, sessions: null, last: { sessions: 7, price: 21250, planned: 7 } });
  });

  it("3시간 반을 2시간만 듣는 학생 — 지난 달 비율(2/3)이 이번 달 예정에 따라온다 · 0.5 단위", () => {
    expect(suggestFromLastMonth(13.5, last({ confirmedSessions: 6 }), 9)).toMatchObject({ price: 21250, sessions: 9 });
    expect(suggestFromLastMonth(8, last({ confirmedSessions: 4.3 }), 6)).toMatchObject({ sessions: 5.5 });
  });

  it("가운데 값(0.25)은 아래로 — 학부모에게 더 받지 않는다", () => {
    expect(suggestFromLastMonth(7, last({ confirmedSessions: 4.5 }), 6)).toMatchObject({ sessions: 5 });
  });

  it("🔴 비율이 1 이상이면 따르지 않는다 — 요일을 줄인 학생의 지난 달 예정이 지금 요일로 줄어 더 청구되는 것을 막는다", () => {
    expect(suggestFromLastMonth(9, last({ confirmedSessions: 13 }), 9)).toMatchObject({ price: 21250, sessions: null });
  });

  it("🔴 이번 달 예정이 0·없음이면 아무것도 안 채운다 — 0시수 × 단가 = 0원 확정 방지", () => {
    expect(suggestFromLastMonth(0, last(), 9)).toBeNull();
    expect(suggestFromLastMonth(null, last(), 9)).toBeNull();
  });

  it("지난 달 예정이 없거나 0이면 비율을 안 쓴다(단가만)", () => {
    expect(suggestFromLastMonth(9, last(), null)).toMatchObject({ price: 21250, sessions: null });
    expect(suggestFromLastMonth(9, last(), 0)).toMatchObject({ sessions: null });
  });

  it("월 정액(EiE)·단가 없음·지난 달 확정 없음·일수 기준 옛 확정은 제안하지 않는다", () => {
    expect(suggestFromLastMonth(9, last({ pricingMode: "monthly" }), 9)).toBeNull();
    expect(suggestFromLastMonth(9, last({ unitPrice: null }), 9)).toBeNull();
    expect(suggestFromLastMonth(9, last({ unitPrice: 0 }), 9)).toBeNull();
    expect(suggestFromLastMonth(9, last({ quantityBasis: "days" }), 6)).toBeNull();
    expect(suggestFromLastMonth(9, null, 9)).toBeNull();
  });

  it("비율로 줄인 시수가 칸에 그대로 있을 때만 '손대지 않은 비율 칸'", () => {
    const row = { confirmedSessions: null, lastMonth: { price: 21250, sessions: 9, last: { sessions: 6, price: 21250, planned: 9 } } };
    expect(isUntouchedScaledSessions(row, "9")).toBe(true);
    expect(isUntouchedScaledSessions(row, "10")).toBe(false);
    expect(isUntouchedScaledSessions({ ...row, confirmedSessions: 9 }, "9")).toBe(false);
    expect(isUntouchedScaledSessions({ ...row, lastMonth: { ...row.lastMonth, sessions: null } }, "9")).toBe(false);
  });
});
