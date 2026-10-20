import { describe, expect, it } from "vitest";
import { clipTrend, monthlyPoints, yearlyPoints } from "./trend-points";

describe("clipTrend — 시작 달 전 점 빼기(원장 2026-10-20 '2026년 4월부터')", () => {
  it("🔴 연도별 옛 해만 빠지면 각주용 시작 달만 · 카드 머리('N월부터')는 월별이 실제로 잘렸을 때만(적대 재리뷰 2026-10-20)", () => {
    // 2027-05: 월별 12개월(2026-06~)은 4월보다 뒤라 그대로 · 연도별 2025년 말 점만 빠진다.
    const later = clipTrend(monthlyPoints("2027-05-20"), yearlyPoints("2027-05-20", 2025), "2026-04");
    expect(later.monthly).toHaveLength(12);
    expect(later.yearly.map((p) => p.key)).toEqual(["2026", "2027"]);
    expect(later.trustFrom).toBe("2026-04");
    expect(later.monthlyFrom).toBeNull();
    const now = clipTrend(monthlyPoints("2026-10-20"), yearlyPoints("2026-10-20", 2025), "2026-04");
    expect(now.monthly[0]!.key).toBe("2026-04");
    expect(now.monthlyFrom).toBe("2026-04");
    const none = clipTrend(monthlyPoints("2026-10-20"), yearlyPoints("2026-10-20", 2026), null);
    expect([none.trustFrom, none.monthlyFrom]).toEqual([null, null]);
  });
});
