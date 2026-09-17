import { describe, expect, it } from "vitest";
import { receiptLines } from "./receipt-allocation";
import { initialReceiptDraft, receiptMatchesClass, suggestReceiptAllocations, type SuggestionTerm, type TransferEnrollment } from "./receipt-suggestion";

const term = (id: string, extra: Partial<SuggestionTerm> = {}): SuggestionTerm => ({ id, classId: id, className: `중등E_중1 정규 ${id}`, subject: "english", pricingMode: "per_session", plannedSessions: 22, confirmedSessions: 22, unitPrice: 12000, ...extra });
const enrolled = (id: string, extra: Partial<TransferEnrollment> = {}): TransferEnrollment => ({ class_id: id, start_date: "2026-09-01", end_date: null, is_transferred: false, is_transferred_in: false, ...extra });
const bill = (name = "중등E_중1 정규 B Jane 화목금 18:20-20:10", amount = 264000) => ({ kind: "수업", description: name, amount, discount: 96000 });
const history = [enrolled("A", { start_date: "2026-07-01", end_date: "2026-08-31", is_transferred: true }), enrolled("B", { is_transferred_in: true })];
const propose = (ts: SuggestionTerm[], hs = history, bs = [bill()]) => suggestReceiptAllocations("2026-09", receiptLines(bs), ts, hs);

describe("수납 자동 연결·반 이동 배분", () => {
  it("반명 내부 띄어쓰기는 달라도 끝 반 코드는 구분한다", () => {
    const t = { classId: "D", className: "중등E_초등 브릿지 D" };
    expect(receiptMatchesClass({ description: "중등E_초등브릿지 D Elsa 화수금" }, t)).toBe(true);
    expect(receiptMatchesClass({ description: "중등E_초등브릿지 DA Elsa 화수금" }, t)).toBe(false);
  });
  it("한 수납과 한 반이 일치하면 할인 전 금액을 자동으로 채운다", () => {
    const s = propose([term("B")], [enrolled("B")]);
    expect(s[0]).toMatchObject({ kind: "match", rows: [{ termId: "B", amount: 264000 }] });
    expect(initialReceiptDraft([{ id: "B", amount: 100 }], s).B).toEqual({ line: "0", amount: "264000" });
  });
  it("월초 이동: 지난달 종료반 0원, 현재 반에 전액(남은 오래된 계획값은 무시)", () => {
    expect(propose([term("A", { plannedSessions: 2 }), term("B")])[0].rows).toEqual([{ termId: "A", amount: 0 }, { termId: "B", amount: 264000 }]);
  });
  it("중간 이동: 월 전체 확정값 대신 수강 기간의 4:18시수로 배분하고 원 단위 합계를 지킨다", () => {
    const h = [enrolled("A", { start_date: "2026-07-01", end_date: "2026-09-08", is_transferred: true }), enrolled("B", { start_date: "2026-09-08", is_transferred_in: true })];
    const s = propose([term("A", { plannedSessions: 4 }), term("B", { plannedSessions: 18 })], h, [bill(undefined, 264001)])[0];
    expect(s.rows.map((r) => r.amount)).toEqual([48000, 216001]);
  });
  it("명시적으로 0시수 확정한 반에는 배분하지 않는다", () => {
    const h = [enrolled("A", { end_date: "2026-09-08", is_transferred: true }), enrolled("B", { start_date: "2026-09-08", is_transferred_in: true })];
    expect(propose([term("A", { confirmedSessions: 0, plannedSessions: 4 }), term("B")], h)[0].rows[0].amount).toBe(0);
  });
  it("반 이동 표식 없는 병행 수업과 다른 과목은 합치지 않는다", () => {
    expect(propose([term("A"), term("B")], history.map((e) => ({ ...e, is_transferred: false })))[0].rows).toHaveLength(1);
    expect(propose([term("A", { subject: "math" }), term("B")])[0].rows).toHaveLength(1);
  });
  it("반명 중복·부분명·수납 두 건 중 선택이 모호하면 자동 연결하지 않는다", () => {
    expect(propose([term("B")], [enrolled("B")], [bill(), bill()])).toEqual([]);
    expect(propose([term("A")], [enrolled("A")], [bill("중등E_중1 정규 AB Jane")])).toEqual([]);
    expect(propose([term("B"), term("C", { className: term("B").className })], [enrolled("B"), enrolled("C")])).toEqual([]);
  });
  it("이동 후 반이 두 개면 임의의 이동 짝을 만들지 않는다", () => {
    const s = propose([term("A"), term("B"), term("C")], [...history, enrolled("C", { is_transferred_in: true })]);
    expect(s[0].rows).toEqual([{ termId: "B", amount: 264000 }]);
  });
  it("이미 저장한 0원이나 직접 배분한 금액은 자동으로 덮어쓰지 않는다", () => {
    const s = propose([term("A"), term("B")]);
    const saved = [{ id: "A", amount: 0, allocationLineIndex: 0, allocatedAmount: 264000 }, { id: "B", amount: 264000, allocationLineIndex: 0, allocatedAmount: 0 }];
    expect(initialReceiptDraft(saved, s).B.amount).toBe("0");
    expect(initialReceiptDraft(saved.map((t) => ({ ...t, allocationStale: true })), s).B.line).toBe("");
  });
  it("현재 수납에 다른 수동 연결이 있으면 자동 배분으로 합계를 깨지 않는다", () => {
    const s = propose([term("B")], [enrolled("B")]);
    const d = initialReceiptDraft([{ id: "B", amount: null }, { id: "manual", amount: 0, allocationLineIndex: 0, allocatedAmount: 264000 }], s);
    expect(d.B.line).toBe("");
  });
  it("종료반 단독 수납과 명시적 0시수의 양수 청구는 검토로 남긴다", () => {
    expect(propose([term("B")], [enrolled("B", { end_date: "2026-08-31" })])).toEqual([]);
    expect(propose([term("B", { confirmedSessions: 0 })], [enrolled("B")])).toEqual([]);
  });
});
