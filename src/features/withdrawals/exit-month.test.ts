import { describe, expect, it } from "vitest";
import { exitCountDate, exitMonthOf, paidTuitionMonths } from "./exit-month";

const row = (period: string, status = "paid", amount_paid: number | string = 300000, category = "tuition") => ({ period, status, amount_paid, category });

describe("퇴원월 = 수강료를 낸 마지막 달", () => {
  it("10/1 퇴원 · 9월까지 냄 → 9월 퇴원(기간 판정 9/30)", () => {
    const paid = paidTuitionMonths([row("2026-08"), row("2026-09")]);
    expect(exitMonthOf("2026-10-01", paid)).toBe("2026-09");
    expect(exitCountDate("2026-10-01", paid)).toBe("2026-09-30");
  });

  it("10/15 퇴원 · 10월 내고 일부 환불 → 10월 퇴원(퇴원일 그대로)", () => {
    const paid = paidTuitionMonths([row("2026-09"), row("2026-10", "partial", 120000)]);
    expect(exitMonthOf("2026-10-15", paid)).toBe("2026-10");
    expect(exitCountDate("2026-10-15", paid)).toBe("2026-10-15");
  });

  it("10월 청구가 전액 환불·취소·미납이면 낸 달이 아니다", () => {
    for (const r of [row("2026-10", "refunded"), row("2026-10", "void"), row("2026-10", "unpaid", 0)]) {
      expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), r]))).toBe("2026-09");
    }
  });

  it("전액 환불은 상태가 paid여도 줄의 환불로 낸 달이 아니다 · 일부 환불은 낸 달", () => {
    const line = (refund: number, type: string) => [{ kind: "수업", description: "수학", amount: 300000, paid: 300000, refunds: [{ status: "active", type, amount: refund }] }];
    const full = { ...row("2026-10"), line_items: line(300000, "full") };
    const partial = { ...row("2026-10"), line_items: line(120000, "partial") };
    expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), full]))).toBe("2026-09");
    expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), partial]))).toBe("2026-10");
  });

  it("수업료가 아닌 청구(교재 등)는 보지 않는다", () => {
    expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), row("2026-10", "paid", 30000, "material")]))).toBe("2026-09");
  });

  it("낸 기록이 없으면 퇴원일의 달", () => {
    expect(exitMonthOf("2026-10-15", [])).toBe("2026-10");
    expect(exitCountDate("2026-10-15", [])).toBe("2026-10-15");
  });

  it("퇴원일 뒤 달에 낸 기록은 보지 않는다", () => {
    expect(exitMonthOf("2026-10-15", ["2026-09", "2026-11"])).toBe("2026-09");
  });

  it("2월 말일도 맞게", () => {
    expect(exitCountDate("2026-03-02", ["2026-02"])).toBe("2026-02-28");
  });
});
