import { describe, it, expect } from "vitest";
import { summarizeInvoices, type InvoiceSummaryInput } from "./calc";

const row = (p: Partial<InvoiceSummaryInput>): InvoiceSummaryInput => ({
  amountTotal: 0,
  amountPaid: 0,
  amountDiscount: 0,
  status: "unpaid",
  ...p,
});

describe("summarizeInvoices", () => {
  it("빈 배열 → 0 (0-나눗셈 방어)", () => {
    const s = summarizeInvoices([], "2026-06");
    expect(s.totalCount).toBe(0);
    expect(s.totalBilled).toBe(0);
    expect(s.outstanding).toBe(0);
    expect(s.paymentRate).toBe(0);
  });

  it("완납·부분·미수 혼합 합산 + 상태별 카운트", () => {
    const s = summarizeInvoices(
      [
        row({ amountTotal: 100, amountPaid: 100, status: "paid" }),
        row({ amountTotal: 100, amountPaid: 40, status: "partial" }),
        row({ amountTotal: 100, amountPaid: 0, status: "unpaid" }),
      ],
      "2026-06",
    );
    expect(s.totalCount).toBe(3);
    expect(s.paidCount).toBe(1);
    expect(s.partialCount).toBe(1);
    expect(s.unpaidCount).toBe(1);
    expect(s.totalBilled).toBe(300);
    expect(s.totalCollected).toBe(140);
    expect(s.outstanding).toBe(160);
    expect(s.paymentRate).toBeCloseTo(46.667, 2);
  });

  it("할인 합산", () => {
    const s = summarizeInvoices(
      [row({ amountTotal: 100, amountPaid: 80, amountDiscount: 20, status: "paid" })],
      "2026-06",
    );
    expect(s.totalDiscount).toBe(20);
  });

  it("전액 수납 → 100%", () => {
    const s = summarizeInvoices(
      [row({ amountTotal: 50, amountPaid: 50, status: "paid" })],
      "2026-06",
    );
    expect(s.paymentRate).toBe(100);
  });

  it("period 미지정 시 현재 달(YYYY-MM)", () => {
    const s = summarizeInvoices([]);
    expect(s.period).toMatch(/^\d{4}-\d{2}$/);
  });
});
