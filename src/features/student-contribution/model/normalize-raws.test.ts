import { describe, expect, it } from "vitest";
import { scoreRaws, reconcileMonth } from "./calc";
import { DEFAULT_CONFIG, emptyRaws, resolveConfig } from "./config";
import { normalizeStoredRaws } from "./normalize-raws";

describe("seminar metric backward compatibility", () => {
  it("reads old frozen raws without modifying them or accepting other missing keys", () => {
    const old = { ...emptyRaws() } as Record<string, unknown>;
    delete old.parentSeminarEvents;
    expect(normalizeStoredRaws(old)).toEqual(emptyRaws());
    expect(old).not.toHaveProperty("parentSeminarEvents");
    delete old.tuitionWon;
    expect(() => normalizeStoredRaws(old)).toThrow("tuitionWon");
    expect(() => normalizeStoredRaws({ ...emptyRaws(), parentSeminarEvents: undefined })).toThrow();
    expect(() => normalizeStoredRaws({ ...emptyRaws(), parentSeminarEvents: 1.5 })).toThrow();
  });
  it("upgrades old settings with only the new rate disabled", () => {
    const old = structuredClone(DEFAULT_CONFIG) as { version: number; rates: Record<string, unknown> };
    delete old.rates.parentSeminarEvents;
    const config = resolveConfig(old);
    expect(config.rates.parentSeminarEvents).toEqual({ enabled: false, points: 5 });
    expect(scoreRaws({ ...emptyRaws(), tuitionWon: 100_000, parentSeminarEvents: 500 }, config).total).toBe(1);
    delete old.rates.tuitionWon;
    expect(() => resolveConfig(old)).toThrow();
  });
  it("counts each recognized event without a cap when explicitly enabled", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.rates.parentSeminarEvents = { enabled: true, points: 2 };
    const score = scoreRaws({ ...emptyRaws(), parentSeminarEvents: 12 }, config);
    expect(score).toMatchObject({ total: 24, operations: 24, participation: 0 });
  });
  it("puts historical imports and later cancellations into the open month exactly once", () => {
    const old = { month: "2025-07", raws: emptyRaws(), correction: emptyRaws(), closedAt: "2025-08-01" };
    const input = { month: "2026-10", todayTotals: { ...emptyRaws(), parentSeminarEvents: 3 }, currentFacts: emptyRaws(), closed: [old] };
    expect(reconcileMonth(input).correction.parentSeminarEvents).toBe(3);
    expect(reconcileMonth(input)).toEqual(reconcileMonth(input));
    const imported = { ...reconcileMonth(input), closedAt: "2026-11-01" };
    expect(reconcileMonth({ ...input, month: "2026-11", todayTotals: { ...emptyRaws(), parentSeminarEvents: 2 }, closed: [old, imported] }).correction.parentSeminarEvents).toBe(-1);
    expect(old.raws.parentSeminarEvents).toBe(0);
  });
});
