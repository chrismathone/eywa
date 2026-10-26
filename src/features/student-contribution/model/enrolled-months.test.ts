import { expect, it } from "vitest";
import { billingMonths, type ContributionInvoice, type HistoricalBill } from "./billing";
import { enrolledMonthCounts } from "./enrolled-months";

it("동시 수강·중복·빈 달·전액 환불·취소·기타를 구분하고 미납 청구와 과목 미확정은 센다", () => {
  const history: HistoricalBill = { id: "h", studentId: "s", month: "2025-12", lesson: true, billed: 100000, paid: 100000, refunded: false, subject: "math" };
  const invoice = (id: string, month: string, overrides: Partial<ContributionInvoice> = {}): ContributionInvoice => ({
    id, student_id: "s", period: month, category: "tuition", status: "paid", amount_total: 100000, amount_paid: 100000,
    line_items: [{ kind: "수업", amount: 100000, paid: 100000 }], ...overrides });
  const bills = billingMonths({ history: [history, { ...history, id: "refund", refunded: true }], aywaFrom: "2026-01", through: "2026-10", subjectOf: () => null,
    invoices: [invoice("jan", "2026-01"), invoice("jan2", "2026-01"), invoice("unpaid", "2026-03", { status: "unpaid", amount_paid: 0 }),
      invoice("void", "2026-04", { status: "void" }), invoice("bus", "2026-05", { line_items: [{ kind: "기타", description: "스쿨버스비", amount: 100000, paid: 100000 }] }),
      invoice("future", "2026-11")] });
  const seeds = bills.map((b) => b.seed);
  expect(enrolledMonthCounts([...seeds, ...seeds]).get("s")).toBe(2);
});
