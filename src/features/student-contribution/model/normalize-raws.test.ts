import { describe, expect, it } from "vitest";
import { scoreRaws, reconcileMonth } from "./calc";
import { configForStorage, DEFAULT_CONFIG, emptyRaws, resolveConfig } from "./config";
import { normalizeStoredRaws, rawsForStorage } from "./normalize-raws";

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
it("월별 완료 수치를 주·숙제 건수로 바꾸지 않고 새 단위만 읽는다", () => {
  const old: Record<string, unknown> = { ...emptyRaws(), perfectMonths: 3, videoMonths: 2 };
  delete old.perfectWeeks; delete old.videoAssignments;
  expect(normalizeStoredRaws(old)).toEqual(emptyRaws());
  expect(old.perfectMonths).toBe(3);
  expect(normalizeStoredRaws({ ...old, perfectWeeks: 8, videoAssignments: 14 })).toMatchObject({ perfectWeeks: 8, videoAssignments: 14 });
  expect(() => normalizeStoredRaws({ ...old, perfectWeeks: undefined })).toThrow();
  expect(() => normalizeStoredRaws({ ...old, videoAssignments: 0.5 })).toThrow();
  expect(rawsForStorage(emptyRaws())).toMatchObject({ perfectMonths: 0, videoMonths: 0 });
  const settings = structuredClone(DEFAULT_CONFIG) as { rates: Record<string, unknown> };
  delete settings.rates.perfectWeeks; delete settings.rates.videoAssignments;
  settings.rates.perfectMonths = { enabled: true, points: 10 };
  expect(resolveConfig(settings).rates).toMatchObject({ perfectWeeks: { enabled: true, points: 1 }, videoAssignments: { enabled: true, points: 1 } });
  expect(configForStorage(resolveConfig(settings)).rates).toMatchObject({ perfectMonths: { enabled: false, points: 0 }, videoMonths: { enabled: false, points: 0 } });
});
it("새 단위로 재계산한 과거 실적은 열린 달에 한 번만 정정한다", () => {
  const oldRaw: Record<string, unknown> = { ...emptyRaws(), perfectMonths: 1, videoMonths: 1 };
  delete oldRaw.perfectWeeks; delete oldRaw.videoAssignments;
  const closed = [{ month: "2026-09", raws: normalizeStoredRaws(oldRaw), correction: emptyRaws(), closedAt: "2026-10-01" }];
  const currentFacts = { ...emptyRaws(), perfectWeeks: 2, videoAssignments: 4 };
  const todayTotals = { ...emptyRaws(), perfectWeeks: 6, videoAssignments: 16 };
  const current = reconcileMonth({ month: "2026-10", todayTotals, currentFacts, closed });
  expect(current.correction).toMatchObject({ perfectWeeks: 4, videoAssignments: 12 });
  expect(scoreRaws(todayTotals, DEFAULT_CONFIG).participation).toBe(22);
  const next = reconcileMonth({ month: "2026-11", todayTotals, currentFacts: emptyRaws(), closed: [...closed, { ...current, closedAt: "2026-11-01" }] });
  expect(next.correction).toEqual(emptyRaws());
});
