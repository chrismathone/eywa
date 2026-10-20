import { describe, expect, it } from "vitest";
import { expenseTrend } from "./expense-trend";
import { parseStatsPeriod } from "@/features/stats/period";

const TODAY = "2026-10-20";

describe("expenseTrend — 지출 추이", () => {
  const rows = [
    { date: "2026-10-01", amount: 100_000, currency: "KRW", category: "운영비" },
    { date: "2026-10-01", amount: 50_000, currency: "KRW", category: "마케팅" },
    { date: "2026-10-03", amount: 30, currency: "USD", category: "운영비" },
    { date: "2026-09-30", amount: 70_000, currency: "KRW", category: "운영비" },
  ];

  it("일별 — 주 통화만 선으로 더하고(₩·$ 섞지 않음) 다른 통화는 기간 합계로 따로 · 분류 선", () => {
    const t = expenseTrend(rows, parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY), "KRW");
    expect([t.currency, t.total[0], t.count[0], t.total[2]]).toEqual(["KRW", 150_000, 2, 0]);
    expect(t.others).toEqual([{ currency: "USD", total: 30, count: 1 }]);
    // 칸마다 다른 통화도 남는다 — 그 칸에서 빠지는 지출이 없다.
    expect(t.othersAt[2]).toEqual([{ currency: "USD", total: 30, count: 1 }]);
    expect(t.categories.map((c) => [c.category, c.values[0]])).toEqual([["운영비", 100_000], ["마케팅", 50_000]]);
  });

  it("월별 — 달로 묶는다 · 지출이 없으면 기본 통화", () => {
    const t = expenseTrend(rows, parseStatsPeriod({}, TODAY), "KRW");
    expect([t.total.at(-2), t.total.at(-1)]).toEqual([70_000, 150_000]);
    expect(expenseTrend([], parseStatsPeriod({}, TODAY), "KRW").currency).toBe("KRW");
  });
});
