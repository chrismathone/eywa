import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, emptyRaws } from "./config";
import { reconcileMonth, scoreRaws, sumRaws } from "./calc";

describe("원생 로열티 누적과 정정", () => {
  it("직원 점수의 100/100000 상한을 물려받지 않는다", () => {
    expect(scoreRaws({ ...emptyRaws(), referralConsult: 100_000 }, DEFAULT_CONFIG).total).toBe(500_000);
  });
  it("금액은 원 단위로 합친 뒤 10만원당 점수를 낸다", () => {
    const raws = sumRaws([33333, 33333, 33334].map((tuitionWon) => ({ ...emptyRaws(), tuitionWon })));
    expect(scoreRaws(raws, DEFAULT_CONFIG).total).toBe(1);
    expect(scoreRaws({ ...emptyRaws(), tuitionWon: 1 }, DEFAULT_CONFIG).total).toBe(0.00001);
  });
  it("마감한 실적도 현재 배점으로 재채점하며 입력은 그대로다", () => {
    const raws = { ...emptyRaws(), referralConsult: 2, tuitionWon: 300_000 };
    const config = structuredClone(DEFAULT_CONFIG);
    config.rates.referralConsult.points = 8;
    expect(scoreRaws(raws, config).total).toBe(19);
    expect(scoreRaws(raws, DEFAULT_CONFIG).total).toBe(13);
  });
  it("지난달 환불·백필을 이번 달 정정으로 나타내고 재집계해도 중복하지 않는다", () => {
    const closed = [{ month: "2026-09", raws: { ...emptyRaws(), tuitionWon: 300_000 }, correction: emptyRaws(), closedAt: "2026-10-01" }];
    const before = structuredClone(closed);
    const args = { month: "2026-10", todayTotals: { ...emptyRaws(), tuitionWon: 400_000, referralConsult: 1 },
      currentFacts: { ...emptyRaws(), tuitionWon: 200_000 }, closed };
    const row = reconcileMonth(args);
    expect(row.correction.tuitionWon).toBe(-100_000);
    expect(row.correction.referralConsult).toBe(1);
    expect(reconcileMonth(args)).toEqual(row);
    expect(closed).toEqual(before);
    const next = reconcileMonth({ ...args, month: "2026-11", currentFacts: emptyRaws(), closed: [...closed, { ...row, closedAt: "2026-11-01" }] });
    expect(next.correction).toEqual(emptyRaws());
  });
  it("불완전하거나 범위가 잘못된 값으로 점수를 지우지 않는다", () => {
    expect(() => scoreRaws({ ...emptyRaws(), tuitionWon: NaN }, DEFAULT_CONFIG)).toThrow();
    expect(() => reconcileMonth({ month: "2026-10", todayTotals: emptyRaws(), currentFacts: emptyRaws(),
      closed: [{ month: "2026-10", raws: emptyRaws(), correction: emptyRaws(), closedAt: "2026-11-01" }] })).toThrow();
  });
});
