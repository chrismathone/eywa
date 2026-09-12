import { describe, expect, it } from "vitest";
import { ROUGH_KRW_RATES, foldExpenseTotals } from "./expense-total";

describe("foldExpenseTotals — USD는 대충 1,500원으로 원화 합계에 합친다(원장 2026-09-12)", () => {
  it("USD × 1,500을 원화 합계에 더하고 환산 사실을 남긴다", () => {
    const r = foldExpenseTotals([
      { currency: "KRW", total: 1_000_000 },
      { currency: "USD", total: 100 },
    ]);
    expect(ROUGH_KRW_RATES.USD).toBe(1500);
    expect(r.krwTotal).toBe(1_150_000);
    expect(r.converted).toEqual([{ currency: "USD", total: 100, rate: 1500 }]);
    expect(r.unconverted).toEqual([]);
  });
  it("환율이 없는 통화는 합치지 않고 따로 남긴다 — 모르는 환율로 합치면 숫자가 거짓이 된다", () => {
    const r = foldExpenseTotals([
      { currency: "KRW", total: 10 },
      { currency: "JPY", total: 500 },
    ]);
    expect(r.krwTotal).toBe(10);
    expect(r.converted).toEqual([]);
    expect(r.unconverted).toEqual([{ currency: "JPY", total: 500 }]);
  });
  it("원화 행이 없어도(USD만) 합계는 원화로 선다", () => {
    const r = foldExpenseTotals([{ currency: "USD", total: 2 }]);
    expect(r.krwTotal).toBe(3000);
  });
});
