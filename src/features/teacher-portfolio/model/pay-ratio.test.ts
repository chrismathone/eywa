import { describe, expect, it } from "vitest";
import { payDataMonth, payRatioItem, payRatioOf, type PayFacts } from "./pay-ratio";

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
  it("청구서 항목을 반에 못 맞췄거나(80% 미만) 급여를 모르면 비율을 내지 않고 까닭을 남긴다 — 회차 확정과 무관(원장 2026-10-14)", () => {
    expect(payRatioOf(facts({ revenue: null }), 3_000_000, null)).toMatchObject({ raw: null, problem: "청구서에서 담당 반 금액을 찾지 못했습니다", retry: false });
    expect(payRatioOf(facts({ revenue: 0 }), 3_000_000, null)).toMatchObject({ raw: null, retry: false, problem: "담당 반 청구액이 0원입니다" });
    expect(payRatioOf(facts({ billedRows: 3 }), 3_000_000, null)).toMatchObject({ raw: null, problem: "청구서에서 담당 반 금액을 찾지 못한 줄이 많습니다(찾은 줄 6%)" });
    // 프리랜서 실급여(명세서 수업료)가 덜 잡힌 달은 0원으로 만점이 되지 않게 급여를 모르는 것으로.
    expect(payRatioOf(facts({ sheetPay: null, payPending: true }), null, null)).toMatchObject({ raw: null, retry: true, problem: "출석부 실급여(급여명세서 수업료와 같은 계산)가 아직 다 잡히지 않았습니다 — 급여를 직접 입력할 수 있습니다" });
    expect(payRatioOf(facts({ sheetPay: null }), null, null)?.problem).toContain("급여를 알 수 없습니다");
    // 원장 2026-10-14 *"회차 확정은 왜 자꾸 언급해 청구액으로 보라니까"* — 문제 문구에 회차 확정을 적지 않는다.
    for (const f of [{ revenue: null }, { billedRows: 3 }, { sheetPay: null, payPending: true }, { sheetPay: null, payReadFailed: true }]) {
      expect(payRatioOf(facts(f), null, null)?.problem ?? "").not.toContain("회차 확정");
    }
    expect(payRatioOf(facts({ problem: "출석부를 읽지 못했습니다" }), 3_000_000, null)).toMatchObject({ raw: null, problem: "출석부를 읽지 못했습니다" });
    expect(payRatioOf(undefined, 3_000_000, null)).toBeUndefined();
    // 담당 청구 줄이 없는 강사(보강 묶음만)는 비율을 내지 않고, '덜 됐다'와 다른 사유를 남긴다.
    expect(payRatioOf(facts({ rows: 0, billedRows: 0 }), 3_000_000, null)).toMatchObject({
      raw: null, retry: false, problem: "그 달 담당 학생의 청구서가 없습니다",
    });
    expect(payRatioOf(facts({ rows: 0, billedRows: 0, classes: 0, students: 0, enrollments: 0 }), 3_000_000, null)?.problem).toBe("그 달 담당 반이 없습니다");
  });
  it("일시 실패(조회 실패·시간 초과·실급여 비율표)는 다시 셀 칸으로 표시한다 — 그 달 마감을 미룬다", () => {
    expect(payRatioOf(facts({ revenue: null, problem: "시간 초과", retry: true }), 3_000_000, null)).toMatchObject({ raw: null, retry: true });
    expect(payRatioOf(facts({ sheetPay: null, payReadFailed: true }), null, null)).toMatchObject({
      raw: null, retry: true, problem: "출석부 실급여 비율을 읽지 못했습니다(마감 전이면 다음 집계에서 다시 셉니다)",
    });
    // 계약서 월급이 있으면 실급여 비율표 실패와 상관없이 비율이 선다 — 미룰 까닭이 없다.
    expect(payRatioOf(facts({ sheetPay: null, payReadFailed: true }), 3_000_000, null)).toMatchObject({ raw: 33.3, retry: false });
    // 매출(못 맞춘 줄)은 회차 확정을 기다리지 않는다(원장 2026-10-14) · 프리랜서 단가 미확정만 1일에 0점으로 굳지 않게 미룬다 ·
    // 급여를 아예 모르면 미루지 않는다.
    expect(payRatioOf(facts({ billedRows: 3 }), 3_000_000, null)?.retry).toBe(false);
    expect(payRatioOf(facts({ revenue: null, billedRows: 0 }), 3_000_000, null)?.retry).toBe(false);
    expect(payRatioOf(facts({ billedRows: 3, sheetPay: null, payPending: true }), null, null)?.retry).toBe(false);
    expect(payRatioOf(facts({ sheetPay: null }), null, null)?.retry).toBe(false);
    // 계약서 월급이 있으면 프리랜서 단가 대기와 상관없이 비율이 선다.
    expect(payRatioOf(facts({ sheetPay: null, payPending: true }), 3_000_000, null)).toMatchObject({ raw: 33.3, retry: false });
  });
  it("지표에는 금액이 없다 — 비율·출처·학생 수·반 수만, 계산하지 않은 달은 '계산 전'", () => {
    const item = payRatioItem(payRatioOf(facts(), 3_000_000, null));
    expect(JSON.stringify(item)).not.toMatch(/9000000|3000000|3600000/);
    expect(item).toMatchObject({ id: "payRatio", raw: 33.3, source: "계약서 월급", basis: "급여 비율 33.3% · 계약서 월급" });
    expect(payRatioItem(undefined)).toMatchObject({ raw: null, uncounted: true, basis: "아직 계산 전" });
  });
  it("2026-10부터 지난달 값으로 매기고 근거에 그 달을 밝힌다 — 그 전 달은 그 달 값(원장 2026-10-15)", () => {
    expect([payDataMonth("2026-10"), payDataMonth("2027-01"), payDataMonth("2026-09")]).toEqual(["2026-09", "2026-12", "2026-09"]);
    const prev = payRatioItem(payRatioOf(facts(), 3_000_000, null, "2026-09"));
    expect(prev.basis).toBe("지난달(9월) 급여 비율 33.3% · 계약서 월급");
    expect(prev.reason).toMatch(/^이번 달 급여는 월말이 돼야 확정되므로 지난달\(9월\) 급여 ÷ 지난달\(9월\) 매출로 매깁니다/);
    const waiting = payRatioItem(payRatioOf(facts({ sheetPay: null, payPending: true }), null, null, "2026-09"));
    expect(waiting.basis).toBe("지난달(9월) 값 · 출석부 실급여(급여명세서 수업료와 같은 계산)가 아직 다 잡히지 않았습니다 — 급여를 직접 입력할 수 있습니다");
  });
  it("지난달 담당 반이 없던 새 선생님은 합계에서 제외 표식 — 그 달 값으로 매기는 달엔 없다(원장 2026-10-15)", () => {
    const none = facts({ revenue: null, rows: 0, billedRows: 0, classes: 0, students: 0, enrollments: 0 });
    const r = payRatioOf(none, 3_000_000, null, "2026-09");
    expect(r).toMatchObject({ raw: null, newcomer: true, retry: false, problem: "그 달 담당 반이 없습니다(새로 맡은 선생님 — 합계에서 제외)" });
    expect(payRatioItem(r)).toMatchObject({ newcomer: true, basis: "지난달(9월) 값 · 그 달 담당 반이 없습니다(새로 맡은 선생님 — 합계에서 제외)" });
    expect(payRatioOf(none, 3_000_000, null)?.newcomer).toBeUndefined();
    // 조회 실패로 빈 재료(emptyFacts)는 새 선생님이 아니다 — 다시 셀 칸.
    expect(payRatioOf({ ...none, problem: "출석부를 읽지 못했습니다", retry: true }, null, null, "2026-09")?.newcomer).toBeUndefined();
    expect(payRatioOf(facts(), 3_000_000, null, "2026-09")?.newcomer).toBeUndefined();
  });
  it("반별 비중은 근거 줄로 싣는다 — 금액은 없다(원장 2026-10-15)", () => {
    const byClass = [{ className: "A반", students: 10, rows: 10, billed: 10, share: 60 }, { className: "B반", students: 5, rows: 5, billed: 4, share: 40 }];
    const item = payRatioItem(payRatioOf(facts({ byClass }), 3_000_000, null, "2026-09"));
    expect(item.detail).toEqual(byClass);
    expect(JSON.stringify(item)).not.toMatch(/9000000|3000000|3600000/);
    expect(payRatioItem(payRatioOf(facts(), 3_000_000, null)).detail).toEqual([]);
  });
});
