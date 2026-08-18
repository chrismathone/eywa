import { describe, it, expect } from "vitest";
import { resolveLeavePeriod } from "./accrual";
import { applyLeaveGrantOverride } from "./test-grants";

const TESTER = "09705ab8-05cf-48ab-8f06-d54a3d990b5c";

describe("연차 부여 테스트 오버라이드(파일럿 전용)", () => {
  const period = resolveLeavePeriod("2025-01-02", "2026-08-18")!;

  it("테스터는 부여만 100으로 바뀌고 구간은 입사일 계산 그대로", () => {
    const p = applyLeaveGrantOverride(TESTER, period)!;
    expect(p.granted).toBe(100);
    expect(p.start).toBe(period.start);
    expect(p.end).toBe(period.end);
    expect(p.label).toContain("테스트 부여");
  });

  it("명단 밖 계정·null 구간은 그대로", () => {
    expect(applyLeaveGrantOverride("someone-else", period)).toEqual(period);
    expect(applyLeaveGrantOverride(TESTER, null)).toBeNull();
  });
});
