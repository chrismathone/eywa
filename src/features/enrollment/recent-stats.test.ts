import { describe, expect, it } from "vitest";
import { summarizeRecentEnrollment } from "./recent-stats";

describe("콜&상담 전환 과목별 값 — 0178a DB 함수와 같은 규칙", () => {
  it("달 = 상담 시각의 KST 달 · 결과별 셈 · 등록분 결제 합 · 빈 달 전환율은 null", () => {
    const rows = [
      // 2026-09-30 23:30 KST = 2026-09-30T14:30Z → 9월
      { consultedAt: "2026-09-30T14:30:00Z", outcome: "enrolled", paymentAmount: 300000, subject: "math" },
      // 2026-10-01 00:30 KST = 2026-09-30T15:30Z → 10월(UTC 날짜로 자르면 9월로 틀린다)
      { consultedAt: "2026-09-30T15:30:00Z", outcome: "declined", paymentAmount: null, subject: "math" },
      { consultedAt: "2026-10-05T01:00:00Z", outcome: "consulted", paymentAmount: 999, subject: null },
    ];
    const stats = summarizeRecentEnrollment(rows, "2026-10-14");
    expect(stats.months.map((m) => [m.month, m.total, m.enrolled, m.declined, m.open, m.paidSum, m.rate])).toEqual([
      ["2026-09", 1, 1, 0, 0, 300000, 100],
      ["2026-10", 2, 0, 1, 1, 0, 0],
    ]);
    expect(stats.total).toBe(3);
    expect(stats.rate).toBe(33);
    expect(summarizeRecentEnrollment([], "2026-01-03").months.map((m) => [m.month, m.rate])).toEqual([["2025-12", null], ["2026-01", null]]);
  });
});
