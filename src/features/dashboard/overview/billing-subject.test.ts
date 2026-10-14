import { describe, expect, it } from "vitest";
import { classifyInvoice, enrollmentInMonth, subjectStatus, summarizeSubjectBilling, type InvoiceForSubject } from "./billing-subject";

// 머리 합계 = 줄 합계(makeedu 청구서와 같은 모양)
const inv = (lines: { amount: number; paid?: number }[], status = "paid", period = "2026-10"): InvoiceForSubject => ({
  period, status, line_items: lines, amount_discount: 0,
  amount_total: lines.reduce((s, l) => s + l.amount, 0), amount_paid: lines.reduce((s, l) => s + (l.paid ?? 0), 0),
});
const line = (description: string, amount: number, paid = amount, extra: Record<string, unknown> = {}) => ({ kind: "수업", description, amount, paid, ...extra });
const MATH = { classId: "c-math", className: "중등M 중3 CR3D", subject: "math" };
const ENG = { classId: "c-eng", className: "Let's Express 1", subject: "english" };

describe("수납 과목 판정 — 청구 항목별(원장 2026-10-14)", () => {
  it("① 반 id ② 반 이름 ③ 한 과목 학생 ④ 모름 — 두 과목에 걸리면 모름", () => {
    const c = classifyInvoice(
      inv([
        line("아무 이름", 100, 100, { classId: "c-eng" }),
        line("중등M 중3 CR3D 월목", 200),
        line("[강아] 강의하는아이들 (허주연)", 50),
      ]),
      [MATH, ENG],
    );
    expect(c.lines.map((l) => l.subject)).toEqual(["english", "math", null]);
    // 한 과목만 다니면 이름이 안 맞아도 그 과목
    expect(classifyInvoice(inv([line("[강아] 강의하는아이들", 50)]), [MATH]).lines[0]!.subject).toBe("math");
    // 줄이 없으면 청구서 한 장을 한 줄로
    const whole = classifyInvoice({ ...inv([]), amount_total: 300, amount_paid: 100 }, [ENG]);
    expect(whole.lines).toEqual([{ subject: "english", amount: 300, paid: 100, discount: 0, left: 200 }]);
  });

  it("과목 합계는 그 과목 줄만 · 과목 모름은 따로 · 두 과목 청구서는 양쪽에 한 건씩", () => {
    const rows = [
      classifyInvoice(inv([line("중등M 중3 CR3D", 200, 200), line("Let's Express 1", 100, 0)], "partial"), [MATH, ENG]),
      classifyInvoice(inv([line("[강아] 강의하는아이들", 50, 0)], "unpaid"), [MATH, ENG]),
    ];
    // 수학 줄을 다 냈으면 청구서 머리가 부분납이어도 수학 관리자에겐 완납(적대 리뷰 2026-10-14 — 다 낸 학부모를 미납자로 부르지 않는다)
    const [math] = summarizeSubjectBilling(rows, ["2026-10"], (s) => s === "math");
    expect(math).toMatchObject({ totalCount: 1, paidCount: 1, partialCount: 0, unpaidCount: 0, totalBilled: 200, totalCollected: 200, outstanding: 0 });
    // 과목 모름 줄에만 남은 미수도 보인다(재리뷰 2026-10-14) — 모든 과목 관리자에게 같은 값
    expect(math!.unclassified).toEqual({ billed: 50, outstanding: 50, count: 1, lines: 1 });
    const [english] = summarizeSubjectBilling(rows, ["2026-10"], (s) => s === "english");
    expect(english).toMatchObject({ totalCount: 1, unpaidCount: 1, partialCount: 0, totalBilled: 100, outstanding: 100 });
    // 다른 달 청구서는 그 달 칸에만
    expect(summarizeSubjectBilling(rows, ["2026-09"], () => true)[0]!.totalCount).toBe(0);
  });

  it("과목 모름 미수 = 청구서 단위로 접어 머리 미수로 자른다 — 학원 전체 미수를 넘지 않는다 · 완납 청구서는 0", () => {
    // 줄 미납액 합(70)이 머리 미수(40)보다 크면 40까지 — 줄마다 따로 자르면 상쇄가 안 돼 학원 전체보다 커진다
    const over = classifyInvoice({ period: "2026-10", status: "partial", amount_total: 100, amount_paid: 60, amount_discount: 0,
      line_items: [{ description: "[강아] 강의하는아이들", amount: 60, paid: 0, unpaid: 60 }, { description: "교재", amount: 40, paid: 30, unpaid: 10 }] }, [MATH, ENG]);
    expect(summarizeSubjectBilling([over], ["2026-10"], () => true)[0]!.unclassified).toEqual({ billed: 100, outstanding: 40, count: 1, lines: 2 });
    const paid = classifyInvoice(inv([line("[강아] 강의하는아이들", 50, 0)], "paid"), [MATH, ENG]);
    expect(summarizeSubjectBilling([paid], ["2026-10"], () => true)[0]!.unclassified).toEqual({ billed: 50, outstanding: 0, count: 0, lines: 1 });
  });

  it("줄에 수납 기록이 없는 청구서(엑셀로 넣기) — 머리 수납·할인을 줄 금액 비율로 나눈다(부분납이 미납으로 뒤집히지 않게)", () => {
    const one = classifyInvoice({ period: "2026-10", status: "partial", amount_total: 300000, amount_paid: 100000, amount_discount: 0,
      line_items: [{ description: "중등M 중3 CR3D", amount: 300000 }] }, [MATH]);
    expect(one.lines[0]).toMatchObject({ subject: "math", paid: 100000, left: 200000 });
    expect(summarizeSubjectBilling([one], ["2026-10"], (s) => s === "math")[0]).toMatchObject({ partialCount: 1, unpaidCount: 0, totalCollected: 100000, outstanding: 200000 });
    // 두 과목 — 금액 비율(2:1)로, 끝전은 마지막 줄에
    const two = classifyInvoice({ period: "2026-10", status: "partial", amount_total: 300, amount_paid: 100, amount_discount: 30,
      line_items: [{ description: "중등M 중3 CR3D", amount: 200 }, { description: "Let's Express 1", amount: 100 }] }, [MATH, ENG]);
    expect(two.lines.map((l) => [l.subject, l.paid, l.discount, l.left])).toEqual([["math", 67, 20, 113], ["english", 33, 10, 57]]);
  });

  it("과목 상태 = 그 과목 줄의 남은 금액 — makeedu 줄 미납액이 먼저 · 적립금도 낸 돈 · 머리가 완납·환불이면 그대로", () => {
    const L = (left: number, amount = 100, discount = 0) => ({ subject: "math", amount, paid: amount - discount - left, discount, left });
    expect(subjectStatus("partial", [L(0)])).toBe("paid");
    expect(subjectStatus("partial", [L(40)])).toBe("partial");
    expect(subjectStatus("unpaid", [L(100)])).toBe("unpaid");
    expect(subjectStatus("unpaid", [L(90, 100, 10)])).toBe("unpaid"); // 할인 뒤 낼 금액이 그대로 남았다
    // 순서는 머리를 만드는 makeedu 규칙과 같다 — 낸 돈이 없으면 남은 금액과 무관하게 미납(적립금·할인으로 0이 돼도)
    expect(subjectStatus("partial", [{ subject: "math", amount: 300, paid: 0, discount: 0, left: 290 }])).toBe("unpaid");
    expect(subjectStatus("partial", [{ subject: "math", amount: 100, paid: 0, discount: 100, left: 0 }])).toBe("unpaid");
    expect(subjectStatus("paid", [L(100)])).toBe("paid");
    expect(subjectStatus("refunded", [L(100)])).toBe("refunded");
    // 적립금으로 낸 줄 — 수납액엔 안 잡혀도 makeedu 미납액이 0이면 다 낸 것
    const points = classifyInvoice(inv([line("중등M 중3 CR3D", 200, 150, { points: 50, unpaid: 0 })], "partial"), [MATH]);
    expect(points.lines[0]!.left).toBe(0);
    expect(subjectStatus("partial", points.lines)).toBe("paid");
    // 미납액이 없는 옛 줄 — 청구−할인−적립금−수납
    expect(classifyInvoice(inv([line("중등M 중3 CR3D", 200, 100, { points: 30 })], "partial"), [MATH]).lines[0]!.left).toBe(70);
  });

  it("수강이 그 달에 걸렸나 — 시작·종료일이 달과 겹치면", () => {
    expect(enrollmentInMonth({ start: "2026-09-15", end: null }, "2026-10")).toBe(true);
    expect(enrollmentInMonth({ start: "2026-11-01", end: null }, "2026-10")).toBe(false);
    expect(enrollmentInMonth({ start: "2026-01-01", end: "2026-09-30" }, "2026-10")).toBe(false);
    expect(enrollmentInMonth({ start: null, end: "2026-10-01" }, "2026-10")).toBe(true);
  });
});
