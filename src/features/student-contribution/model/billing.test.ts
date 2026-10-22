import { describe, expect, it } from "vitest";
import { billingMonths, type ContributionInvoice, type HistoricalBill } from "./billing";
import { sumRaws } from "./calc";
const invoice = (id: string, period: string, line_items: unknown, overrides: Partial<ContributionInvoice> = {}): ContributionInvoice => ({
  id, student_id: "s", period, line_items, category: "tuition", status: "paid", amount_paid: 300_000, amount_total: 300_000, ...overrides,
});
const lesson = (subject = "math", paid = 300_000) => ({ kind: "수업", subject, amount: paid, paid });
const run = (invoices: ContributionInvoice[], history: HistoricalBill[] = []) => billingMonths({ invoices, history,
  aywaFrom: "2026-01", through: "2026-12", subjectOf: (item) => typeof item.subject === "string" ? item.subject : null });
describe("청구 달 기준 운영 기여", () => {
  it("수업료 순액만 세며 한 과목의 여러 반은 과목·달 하나다", () => {
    const rows = run([invoice("i", "2026-03", [lesson(), { ...lesson(), refunds: [{ amount: 50_000, status: "active" }] },
      lesson("english", 200_000), { kind: "교재", amount: 20_000, paid: 20_000 }])]);
    expect(rows[0]!.raws).toMatchObject({ tuitionWon: 750_000, subjectMonths: 2, tenureYears: 0 });
  });
  it("줄별 수납이 없으면 기존 lessonPaid 비율 계산을 따른다", () => {
    const rows = run([invoice("i", "2026-03", [{ kind: "수업", subject: "math", amount: 200_000 }, { kind: "교재", amount: 100_000 }], { amount_paid: 150_000 })]);
    expect(rows[0]!.raws.tuitionWon).toBe(100_000);
  });
  it("빈 달·동시 수강을 중복하지 않고 12번째 청구 달에만 장기 보너스", () => {
    const bills = Array.from({ length: 12 }, (_, i) => invoice(`i${i}`, `2026-${String(i + 1).padStart(2, "0")}`, [lesson(), lesson("english")]));
    const rows = run([...bills, bills[0]!]);
    expect(sumRaws(rows.map((r) => r.raws))).toMatchObject({ subjectMonths: 24, tenureYears: 1 });
    expect(rows.find((r) => r.month === "2026-12")!.raws.tenureYears).toBe(1);
  });
  it("이관 경계 뒤 취소된 청구를 메이크에듀 옛 기록으로 되살리지 않는다", () => {
    const history: HistoricalBill[] = [{ id: "h1", studentId: "s", month: "2025-12", lesson: true, billed: 300_000, paid: 300_000, refunded: false, subject: "math" },
      { id: "h2", studentId: "s", month: "2025-12", lesson: true, billed: 0, paid: 100_000, refunded: true, subject: "math" },
      { id: "h3", studentId: "s", month: "2026-01", lesson: true, billed: 300_000, paid: 300_000, refunded: false, subject: "math" }];
    const rows = run([invoice("i", "2026-01", [lesson()], { status: "void" })], history);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raws).toMatchObject({ tuitionWon: 200_000, subjectMonths: 1 });
  });
  it("과목 불명은 과목을 지어내지 않고 금액과 확인 필요 수를 보존", () => {
    const rows = run([invoice("i", "2026-03", [{ kind: "수업", amount: 300_000, paid: 300_000 }])]);
    expect(rows[0]).toMatchObject({ unknownSubjects: 1, raws: { tuitionWon: 300_000, subjectMonths: 0 } });
  });
  it("취소·환불·미래 청구·기타 항목만 있는 청구는 재원 점수를 만들지 않는다", () => {
    const rows = run([invoice("a", "2026-01", [lesson()], { status: "refunded" }), invoice("b", "2027-01", [lesson()]),
      invoice("c", "2026-03", [{ kind: "교재", amount: 50_000, paid: 50_000 }])]);
    expect(sumRaws(rows.map((r) => r.raws)).subjectMonths).toBe(0);
    expect(sumRaws(rows.map((r) => r.raws)).tuitionWon).toBe(0);
  });
  it("옛 청구 전액 환불은 과목·달에서 빼고 일부 환불·미납 달은 유지한다", () => {
    const original: HistoricalBill = { id: "bill", studentId: "s", month: "2025-12", lesson: true,
      billed: 300_000, paid: 300_000, refunded: false, subject: "math" };
    const refund = { ...original, id: "refund", refunded: true };
    expect(run([], [original, refund])[0]!.raws).toMatchObject({ tuitionWon: 0, subjectMonths: 0 });
    expect(run([], [original, { ...refund, paid: 100_000 }])[0]!.raws).toMatchObject({ tuitionWon: 200_000, subjectMonths: 1 });
    expect(run([], [{ ...original, paid: 0 }])[0]!.raws).toMatchObject({ tuitionWon: 0, subjectMonths: 1 });
  });
});
