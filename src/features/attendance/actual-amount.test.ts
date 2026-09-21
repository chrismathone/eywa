import { expect, it } from "vitest";
import { actualLessonAmount } from "./actual-amount";
const price = { unitPrice: 27250, monthly: false, daysBasis: false };
it("multiplies confirmed per-unit price by attended units, including zero", () => {
  expect(actualLessonAmount([price], 12)).toBe(327000);
  expect(actualLessonAmount([price], 1.5)).toBe(40875);
  expect(actualLessonAmount([price], 0)).toBe(0);
});
it("does not invent a unit price from monthly fees, missing or conflicting prices, or old day-basis units", () => {
  for (const prices of [null, [], [price, { ...price, unitPrice: 30000 }], [{ ...price, monthly: true }], [{ ...price, daysBasis: true }]]) {
    expect(actualLessonAmount(prices, 2)).toBeNull();
  }
});
