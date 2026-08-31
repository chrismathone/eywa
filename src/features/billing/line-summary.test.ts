import { describe, expect, it } from "vitest";
import { summarizeLines } from "./line-summary";
import type { InvoiceLineItem } from "./server/queries";

const li = (p: Partial<InvoiceLineItem> = {}): InvoiceLineItem => ({
  kind: "수업",
  description: "정규반",
  amount: 100000,
  ...p,
});

describe("summarizeLines — 접힌 줄이 대신 말하는 값", () => {
  it("금액은 보이는 라인들의 합", () => {
    const s = summarizeLines([
      li({ amount: 262500, discount: 10000, paid: 0, unpaid: 252500 }),
      li({ amount: 192000, discount: 10000, paid: 0, unpaid: 182000 }),
      li({ kind: "교재", amount: 12000, paid: 12000, unpaid: 0 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.amount).toBe(466500);
    expect(s.discount).toBe(20000);
    expect(s.paid).toBe(12000);
    expect(s.unpaid).toBe(434500);
  });

  it("🔴 전 라인이 미상이면 미납은 undefined — 0(완납)으로 접지 않는다", () => {
    const s = summarizeLines([li({ amount: 100000 }), li({ amount: 50000 })]);
    expect(s.unpaid).toBeUndefined();
    expect(s.paid).toBe(0);
  });

  it("구데이터(첫 라인에만 인보이스 값 합성)도 합계가 인보이스 값과 같아진다", () => {
    // toLines가 만드는 모양 — 둘째 라인부터는 상세가 없다(undefined는 0으로 더해진다).
    const s = summarizeLines([
      li({ amount: 200000, discount: 5000, paid: 0, unpaid: 330000 }),
      li({ amount: 130000 }),
    ]);
    expect(s.amount).toBe(330000);
    expect(s.unpaid).toBe(330000);
  });

  it("구분은 한 종류일 때만 남고 섞이면 null", () => {
    expect(summarizeLines([li(), li()]).kind).toBe("수업");
    expect(summarizeLines([li(), li({ kind: "교재" })]).kind).toBeNull();
  });

  it("결제수단·수납일·청구일은 값이 하나로 모일 때만 (갈리면 null)", () => {
    const same = summarizeLines([
      li({ method: "card", paidDate: "2026-09-01", dueDay: 1 }),
      li({ method: "card", paidDate: "2026-09-01", dueDay: 1 }),
    ]);
    expect(same.method).toBe("card");
    expect(same.paidDate).toBe("2026-09-01");
    expect(same.dueDay).toBe(1);

    const mixed = summarizeLines([
      li({ method: "card", paidDate: "2026-09-01", dueDay: 1 }),
      li({ method: "cash", paidDate: "2026-09-03", dueDay: 5 }),
    ]);
    expect(mixed.method).toBeNull();
    expect(mixed.paidDate).toBeNull();
    expect(mixed.dueDay).toBeNull();
  });

  it("일부만 있는 값은 그 값으로 모인다(빈 라인이 값을 지우지 않게)", () => {
    const s = summarizeLines([li({ dueDay: 1 }), li({ dueDay: null }), li()]);
    expect(s.dueDay).toBe(1);
  });

  it("대표 수납명은 첫 라인", () => {
    expect(summarizeLines([li({ description: "정규 A" }), li({ description: "교재" })]).description).toBe("정규 A");
  });

  it("라인이 0개여도 안 터진다", () => {
    const s = summarizeLines([]);
    expect(s.count).toBe(0);
    expect(s.amount).toBe(0);
    expect(s.unpaid).toBeUndefined();
    expect(s.description).toBe("");
  });
});
