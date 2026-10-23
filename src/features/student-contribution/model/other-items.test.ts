import { expect, it } from "vitest";
import { billingMonths } from "./billing";
import { isOtherContributionItem } from "./other-items";
it("100점 프로젝트와 스쿨버스비를 원본 수정 없이 기타 비용으로 구분한다", () => {
  expect(isOtherContributionItem("25년 100점프로젝트 (1학기 기말)")).toBe(true);
  expect(isOtherContributionItem("100점 프로젝트 (25년 2학기 기말)")).toBe(true);
  expect(isOtherContributionItem("스쿨버스비")).toBe(true);
  expect(isOtherContributionItem("고등수1 월목")).toBe(false);
  const invoice = { id: "i", student_id: "s", category: "tuition", period: "2026-10", status: "paid", amount_total: 120000, amount_paid: 120000,
    line_items: [{ kind: "수업", description: "수학", amount: 100000, paid: 100000 }, { kind: "수업", description: "스쿨버스비", amount: 20000, paid: 20000 }] };
  const rows = billingMonths({ invoices: [invoice], history: [], through: "2026-10", aywaFrom: "2026-01", subjectOf: item => item.description === "수학" ? "math" : null });
  expect(rows[0]!.raws).toMatchObject({ tuitionWon: 100000, subjectMonths: 1 });
  expect(rows[0]!.unknownSubjects).toBe(0);
  expect(invoice.line_items[1]!.kind).toBe("수업");
  expect(billingMonths({ invoices: [], history: [{ id: "h", studentId: "s", name: "100점 프로젝트", month: "2025-06", lesson: true, billed: 50000, paid: 50000, refunded: false, subject: null }], through: "2026-10", aywaFrom: "2026-01", subjectOf: () => null })).toEqual([]);
});
it("스터디케어의 확인된 두 수납명은 기타로 처리하고 수업료·과목·재원 개월에서 제외한다", () => {
  const names = ["[인재원300] 1A스터디케어", "[방학특강] 스터디케어"];
  for (const name of names) {
    expect(isOtherContributionItem(name)).toBe(true);
    const invoice = { id: "i", student_id: "s", category: "tuition", period: "2026-10", status: "paid", amount_total: 50000, amount_paid: 50000,
      line_items: [{ kind: "수업", description: name, amount: 50000, paid: 50000 }] };
    const rows = billingMonths({ invoices: [invoice], history: [], through: "2026-10", aywaFrom: "2026-01", subjectOf: () => "math" });
    expect(rows[0]!.raws).toMatchObject({ tuitionWon: 0, subjectMonths: 0, tenureYears: 0 });
    expect(rows[0]!.seed.active).toBe(false);
    expect(rows[0]!.unknownSubjects).toBe(0);
    expect(invoice.line_items[0]!.kind).toBe("수업");
    expect(billingMonths({ invoices: [], history: [{ id: "h", studentId: "s", name, month: "2025-01", lesson: true, billed: 50000, paid: 50000, refunded: false, subject: "math" }],
      through: "2026-10", aywaFrom: "2026-01", subjectOf: () => "math" })).toEqual([]);
  }
  expect(isOtherContributionItem("중등내신특강(토)")).toBe(false);
  expect(isOtherContributionItem("스터디케어와 별도 수학 수업")).toBe(false);
});
