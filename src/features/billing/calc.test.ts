import { describe, it, expect } from "vitest";
import { summarizeInvoices, invoiceOutstanding, paymentRateOf, paymentRateDisplay, unpaidBreakdown, type InvoiceSummaryInput } from "./calc";

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

  it("할인 후 완납 → 미수금 0 · 수납률 100% (할인을 미수로 잡지 않음)", () => {
    // 청구 667,500 · 할인 10,000 · 수납 657,500 (= 청구−할인) = 완납
    const s = summarizeInvoices(
      [row({ amountTotal: 667500, amountPaid: 657500, amountDiscount: 10000, status: "paid" })],
      "2026-07",
    );
    expect(s.outstanding).toBe(0);
    expect(s.paymentRate).toBe(100);
  });

  it("할인 있는 진짜 부분납부 → 미수금 = 청구−할인−수납", () => {
    // 청구 100 · 할인 20 · 수납 50 → 실청구 80, 미수 30
    const s = summarizeInvoices(
      [row({ amountTotal: 100, amountPaid: 50, amountDiscount: 20, status: "partial" })],
      "2026-06",
    );
    expect(s.outstanding).toBe(30);
    expect(s.paymentRate).toBeCloseTo(62.5, 3); // 50 / (100−20)
  });

  it("refunded/void는 미수 집계에서 제외", () => {
    const s = summarizeInvoices(
      [
        row({ amountTotal: 100, amountPaid: 0, status: "refunded" }),
        row({ amountTotal: 100, amountPaid: 0, status: "void" }),
      ],
      "2026-06",
    );
    expect(s.outstanding).toBe(0);
  });

  it("완납(paid) 행의 양수 잔차(적립금 납부분)는 미수로 잡지 않는다 — 유령 미수 방지", () => {
    // makeedu 적립금으로 낸 몫은 amountPaid에 안 잡혀 paid 행에 잔차가 남는다(실측 7건/351,250원).
    // 완납 여부는 makeedu 미납 합 기준(status)이 진실 — paid면 미수 0.
    const s = summarizeInvoices(
      [row({ amountTotal: 100, amountPaid: 90, amountDiscount: 0, status: "paid" })],
      "2026-06",
    );
    expect(s.outstanding).toBe(0);
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

describe("invoiceOutstanding (행 레벨 미수 — 단일 공식)", () => {
  it("unpaid = 청구−할인−수납", () => {
    expect(invoiceOutstanding(row({ amountTotal: 100, amountDiscount: 20, amountPaid: 30, status: "unpaid" }))).toBe(50);
  });

  it("partial도 동일 공식", () => {
    expect(invoiceOutstanding(row({ amountTotal: 100, amountPaid: 60, status: "partial" }))).toBe(40);
  });

  it("과납(음수 잔차)은 0으로 clamp — 다른 행 미수를 상쇄하지 않도록 행 레벨에서 바닥", () => {
    expect(invoiceOutstanding(row({ amountTotal: 100, amountPaid: 150, status: "partial" }))).toBe(0);
  });

  it("paid는 양수 잔차(적립금 납부분)가 있어도 0 — status가 진실(유령 미수 방지)", () => {
    expect(invoiceOutstanding(row({ amountTotal: 100, amountPaid: 90, status: "paid" }))).toBe(0);
  });

  it("refunded/void는 0", () => {
    expect(invoiceOutstanding(row({ amountTotal: 100, status: "refunded" }))).toBe(0);
    expect(invoiceOutstanding(row({ amountTotal: 100, status: "void" }))).toBe(0);
  });

  it("행별 합 = summarizeInvoices().outstanding (공식 동치 보장)", () => {
    const rows = [
      row({ amountTotal: 100, amountPaid: 30, amountDiscount: 20, status: "unpaid" }),
      row({ amountTotal: 100, amountPaid: 150, status: "partial" }),
      row({ amountTotal: 100, amountPaid: 90, status: "paid" }),
      row({ amountTotal: 100, status: "refunded" }),
    ];
    const sum = rows.reduce((s, r) => s + invoiceOutstanding(r), 0);
    expect(sum).toBe(summarizeInvoices(rows, "2026-07").outstanding);
    expect(sum).toBe(50);
  });
});

describe("paymentRateOf (수납률 — 단일 공식)", () => {
  it("수납/실청구 ×100", () => {
    expect(paymentRateOf(40, 80)).toBe(50);
  });

  it("100% 상한 — 과납·적립금으로 실청구 초과 수납이어도 100", () => {
    expect(paymentRateOf(120, 80)).toBe(100);
  });

  it("실청구 0 이하 → 0 (0-나눗셈 방어)", () => {
    expect(paymentRateOf(50, 0)).toBe(0);
    expect(paymentRateOf(50, -10)).toBe(0);
  });
});

describe("paymentRateDisplay — 미수가 있으면 100%로 적지 않는다", () => {
  // 🔴 실사고 재현(원장 2026-09-10 *"미납건이 존재하는데 100%?"*): 2026-09 실측
  //    실청구 129,664,875 / 수납 129,287,375 = 99.7089% 인데 Math.round가 100으로 적었다.
  it("99.7089%는 100이 아니라 99.7로 적는다", () => {
    expect(paymentRateDisplay(99.7089, 377_500)).toBe("99.7");
  });

  it("미수가 1원이라도 있으면 99.9를 넘지 않는다", () => {
    expect(paymentRateDisplay(99.999, 1)).toBe("99.9");
    expect(paymentRateDisplay(100, 1)).toBe("99.9");
  });

  it("미수가 0이면 100 — 다 받은 달을 못 받은 것처럼 적지 않는다", () => {
    expect(paymentRateDisplay(100, 0)).toBe("100");
    expect(paymentRateDisplay(99.999, 0)).toBe("100");
  });

  it("미수 판정은 금액이지 건수가 아니다 — 잔액 0이면 다 받은 것", () => {
    expect(paymentRateDisplay(100, -500)).toBe("100");
  });

  it("보통 구간은 소수 한 자리", () => {
    expect(paymentRateDisplay(93.1829, 9_458_375)).toBe("93.2");
  });

  it("값이 없으면 —", () => {
    expect(paymentRateDisplay(Number.NaN, 0)).toBe("—");
  });
});

describe("unpaidBreakdown — 부분납과 전액 미납을 뭉치지 않는다", () => {
  it("전부 부분납이면 '미납'이라 적지 않는다", () => {
    expect(unpaidBreakdown({ partialCount: 26, fullyUnpaidCount: 0 })).toBe("부분납 26건");
  });

  it("둘 다 있으면 나란히", () => {
    expect(unpaidBreakdown({ partialCount: 3, fullyUnpaidCount: 2 })).toBe("미납 2건 · 부분납 3건");
  });

  it("둘 다 0이면 빈칸이 아니라 '미수 없음'", () => {
    expect(unpaidBreakdown({ partialCount: 0, fullyUnpaidCount: 0 })).toBe("미수 없음");
  });
});
