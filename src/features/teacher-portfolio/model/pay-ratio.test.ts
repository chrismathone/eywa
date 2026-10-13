import { describe, expect, it } from "vitest";
import { payRatioItem, payRatioOf, type PayFacts } from "./pay-ratio";

/** 매출 대비 급여 — 원장 2026-10-13 *"급여의 3배가 매출이면 만점"* · *"청구액 그대로"* · *"비율만 노출"*. */
const facts = (over: Partial<PayFacts> = {}): PayFacts => ({
  revenue: 9_000_000, sheetPay: 3_600_000, students: 40, classes: 8, enrollments: 50, rows: 50, billedRows: 50, problem: null, ...over,
});

describe("매출 대비 급여", () => {
  it("급여 = 직접 입력 → 계약서 월급 → 출석부 실급여 순, 비율 = 급여 ÷ 청구액", () => {
    expect(payRatioOf(facts(), 3_000_000, 2_700_000)).toMatchObject({ raw: 30, source: "직접 입력" });
    expect(payRatioOf(facts(), 3_000_000, null)).toMatchObject({ raw: 33.3, source: "계약서 월급" });
    expect(payRatioOf(facts(), null, null)).toMatchObject({ raw: 40, source: "출석부 실급여", students: 40, classes: 8, enrollments: 50 });
  });
  it("청구액이 없거나 회차 확정이 덜 됐거나(80% 미만) 급여를 모르면 비율을 내지 않고 까닭을 남긴다", () => {
    expect(payRatioOf(facts({ revenue: null }), 3_000_000, null)).toMatchObject({ raw: null, problem: "출석부 청구액이 없습니다(회차 확정 전)" });
    expect(payRatioOf(facts({ billedRows: 3 }), 3_000_000, null)).toMatchObject({ raw: null, problem: "회차 확정이 아직 덜 됐습니다(청구액이 잡힌 줄 6%)" });
    expect(payRatioOf(facts({ sheetPay: null }), null, null)?.problem).toContain("급여를 알 수 없습니다");
    expect(payRatioOf(facts({ problem: "출석부를 읽지 못했습니다" }), 3_000_000, null)).toMatchObject({ raw: null, problem: "출석부를 읽지 못했습니다" });
    expect(payRatioOf(undefined, 3_000_000, null)).toBeUndefined();
    // 담당 청구 줄이 없는 강사(보강 묶음만)는 비율을 내지 않고, '덜 됐다'와 다른 사유를 남긴다.
    expect(payRatioOf(facts({ rows: 0, billedRows: 0 }), 3_000_000, null)).toMatchObject({
      raw: null, retry: false, problem: "청구서가 있는 담당 줄이 없습니다(보강만 맡았거나 담당 학생 청구서가 없음)",
    });
    expect(payRatioOf(facts({ rows: 0, billedRows: 0, classes: 0, students: 0, enrollments: 0 }), 3_000_000, null)?.problem).toBe("이 달 담당 반이 없습니다");
  });
  it("일시 실패(조회 실패·시간 초과·실급여 비율표)는 다시 셀 칸으로 표시한다 — 그 달 마감을 미룬다", () => {
    expect(payRatioOf(facts({ revenue: null, problem: "시간 초과", retry: true }), 3_000_000, null)).toMatchObject({ raw: null, retry: true });
    expect(payRatioOf(facts({ sheetPay: null, payReadFailed: true }), null, null)).toMatchObject({
      raw: null, retry: true, problem: "출석부 실급여 비율을 읽지 못했습니다(마감 전이면 다음 집계에서 다시 셉니다)",
    });
    // 계약서 월급이 있으면 실급여 비율표 실패와 상관없이 비율이 선다 — 미룰 까닭이 없다.
    expect(payRatioOf(facts({ sheetPay: null, payReadFailed: true }), 3_000_000, null)).toMatchObject({ raw: 33.3, retry: false });
    // 회차 확정 전·급여 모름은 일시 실패가 아니다.
    expect(payRatioOf(facts({ billedRows: 3 }), 3_000_000, null)?.retry).toBe(false);
    expect(payRatioOf(facts({ sheetPay: null }), null, null)?.retry).toBe(false);
  });
  it("지표에는 금액이 없다 — 비율·출처·학생 수·반 수만, 계산하지 않은 달은 '계산 전'", () => {
    const item = payRatioItem(payRatioOf(facts(), 3_000_000, null));
    expect(JSON.stringify(item)).not.toMatch(/9000000|3000000|3600000/);
    expect(item).toMatchObject({ id: "payRatio", raw: 33.3, source: "계약서 월급", basis: "급여 비율 33.3% · 계약서 월급" });
    expect(payRatioItem(undefined)).toMatchObject({ raw: null, uncounted: true, basis: "아직 계산 전" });
  });
});
