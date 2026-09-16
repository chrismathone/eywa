import { describe, expect, it } from "vitest";
import { normalizeInvoiceLineItems, receiptHistoryLines } from "./invoice-line-items";

describe("병합 수납 원본 보존", () => {
  const sourceItems = [
    { kind: "수업", description: "심화", amount: 68000, paid: 68000, unpaid: 0, paidDate: "2026-08-25", method: "card" },
    { kind: "수업", description: "심화", amount: 107000, paid: 107000, unpaid: 0, paidDate: "2026-08-02", method: null },
  ];
  const raw = [{ kind: "수업", description: "심화", amount: 175000, paid: 175000, unpaid: 0, sourceItems }];
  it("수납 표에는 합산 1행과 서로 다른 원본 수납일을 전달한다", () => {
    const lines = normalizeInvoiceLineItems(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(175000);
    expect(lines[0].sourceItems?.map((l) => l.paidDate)).toEqual(["2026-08-25", "2026-08-02"]);
    expect(lines[0].sourceItems?.[0].method).toBe("card");
  });
  it("환불 결제 이력에는 원본만 넣어 이중 합산하지 않는다", () => {
    expect(receiptHistoryLines(raw)).toEqual(sourceItems);
    expect(receiptHistoryLines([{ amount: 10, sourceItems: [] }, null])).toEqual([{ amount: 10, sourceItems: [] }, null]);
  });
  it("구 데이터와 잘못된 입력을 처리하고 원본의 중첩을 제한한다", () => {
    expect(normalizeInvoiceLineItems(null)).toEqual([]);
    expect(normalizeInvoiceLineItems([{ name: "구 수납", amount: "100" }])).toEqual([{ kind: "tuition", description: "구 수납", amount: 100 }]);
    const lines = normalizeInvoiceLineItems([{ ...raw[0], sourceItems: raw }]);
    expect(lines[0].sourceItems?.[0].sourceItems).toBeUndefined();
  });
});
