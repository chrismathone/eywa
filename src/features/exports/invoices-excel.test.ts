import { describe, expect, it } from "vitest";
import type { InvoiceRow } from "@/features/billing/server/queries";
import { invoiceExcelLines } from "./invoices-excel";

const base: InvoiceRow = {
  id: "i1", studentId: "s1", studentName: "홍길동", studentGrade: "중1", period: "2026-09", category: "tuition",
  amountTotal: 300000, amountPaid: 250000, amountDiscount: 0, status: "partial", dueDate: null, paidAt: "2026-09-05T01:00:00+00:00",
  notes: "메모", lineItems: [], paymentMethod: "card", cardCompany: "신한", cashReceiptNumber: null, pointsUsed: 0,
  discountReason: null, billedAt: "2026-09-01", syncAddedAt: null, updatedAt: null,
};

describe("invoiceExcelLines — 수납 엑셀 = 화면과 같은 라인 단위(N3)", () => {
  it("라인 상세가 있는 청구서는 라인마다 한 줄, 결제수단·카드사·적립금·청구일을 싣는다", () => {
    const lines = invoiceExcelLines([
      {
        ...base,
        lineItems: [
          { kind: "수업", description: "수학 정규", amount: 200000, paid: 200000, unpaid: 0, points: 1000, method: "card", paidDate: "2026-09-05", dueDay: 5 },
          { kind: "교재", description: "쎈", amount: 100000, paid: 50000, unpaid: 50000, method: "cash", dueDay: 5 },
        ],
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: "수학 정규", billedOn: "2026-09-05", method: "카드", cardCompany: "신한", points: 1000, unpaid: 0, notes: "메모" });
    expect(lines[1]).toMatchObject({ kind: "교재", method: "현금", cardCompany: "", unpaid: 50000, notes: "" });
  });

  it("라인이 없는 청구서는 청구서 값으로 한 줄(화면 폴백과 같다)", () => {
    const [l] = invoiceExcelLines([base]);
    expect(l).toMatchObject({ description: "메모", amount: 300000, paid: 250000, unpaid: 50000, method: "카드", billedOn: "2026-09-01", paidOn: "2026-09-05" });
  });

  it("'기한 경과만'은 완납 라인을 뺀다", () => {
    const lines = invoiceExcelLines(
      [{ ...base, lineItems: [
        { kind: "수업", description: "a", amount: 1, paid: 1, unpaid: 0 },
        { kind: "수업", description: "b", amount: 1, paid: 0, unpaid: 1 },
      ] }],
      { overdueOnly: true },
    );
    expect(lines.map((l) => l.description)).toEqual(["b"]);
  });
});
