import { describe, expect, it } from "vitest";
import { contractMonthlyPay, monthlyPayFromTerms } from "./contract-pay";

/** 계약서 월급 읽기 — 침산 계약 조건 글의 모양(금액은 지어낸 값). */
describe("계약 조건 글 → 한 달 급여", () => {
  it("월급의 여러 적는 법을 읽는다", () => {
    expect(monthlyPayFromTerms("(주)곰돌이_시용근로계약 : 250만/월")).toBe(2_500_000);
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약2차 : 280만원/월 (2차)")).toBe(2_800_000);
    expect(monthlyPayFromTerms("(주)곰돌이_근로2차:월급 230만")).toBe(2_300_000);
    expect(monthlyPayFromTerms("근로 : 월급 2,200,000원 (포괄임금)")).toBe(2_200_000);
    expect(monthlyPayFromTerms("(주)인재교육_근로계약2차 계약:기본급 200만원 / 2024.03월 강좌수 대비 신규생 증감에 따른 인센티브(인당 10,000원)")).toBe(2_000_000);
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약1차 : 급여계약금 300만원/월")).toBe(3_000_000);
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약: 주 5일, 8시간(9:00~18:00) 260만/월")).toBe(2_600_000);
    expect(monthlyPayFromTerms("연봉 3,600만원")).toBe(3_000_000);
  });
  it("시급·업무별 단가·금액이 둘인 글·비율제는 읽지 않는다(원장이 직접 넣는다)", () => {
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약2차 : 시급 12,000원")).toBeNull();
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약 : 행정&랩실업무 12,000원, 부담임수업 15,000원, 담임수업 20,000원")).toBeNull();
    expect(monthlyPayFromTerms("EIE인재원_근로계약1차 : 시용3개월 주 2회시 120만, 주3회시 180만")).toBeNull();
    expect(monthlyPayFromTerms("(주)곰돌이_프리랜서2차계약: 초50% / 중55% / 매쓰몽 40%")).toBeNull();
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약 : 직책수당 30만/월")).toBeNull();
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약 : 기본급 200만, 수당 30만/월")).toBeNull();
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약 : 월급 250만(제수당 포함)")).toBe(2_500_000);
    expect(monthlyPayFromTerms("(주)곰돌이_근로계약2차 : 시용3개월 / 월급 230만")).toBe(2_300_000);
    expect(monthlyPayFromTerms(null)).toBeNull();
  });
  it("그 달에 걸친 계약 중 가장 늦은 차수부터 — 메모 줄은 보지 않는다", () => {
    const rows = [
      { kind: "contract", start_date: "2025-03-01", end_date: "2026-02-28", terms: "250만/월", seq: 1 },
      { kind: "contract", start_date: "2026-03-01", end_date: null, terms: "280만원/월", seq: 2 },
      { kind: "note", start_date: null, end_date: null, terms: "근로계약:월화목금 주4일 999만원/월", seq: 3 },
    ];
    expect(contractMonthlyPay(rows, "2026-10")).toBe(2_800_000);
    expect(contractMonthlyPay(rows, "2026-01")).toBe(2_500_000);
    expect(contractMonthlyPay(rows, "2024-10")).toBeNull();
    // 가장 늦은 계약을 못 읽으면 옛 계약(끝 날이 비어 남아 있는)으로 내려가지 않는다.
    const switched = [
      { kind: "contract", start_date: "2025-03-01", end_date: null, terms: "250만/월", seq: 1 },
      { kind: "contract", start_date: "2026-09-01", end_date: null, terms: "시급 12,000원", seq: 2 },
    ];
    expect(contractMonthlyPay(switched, "2026-10")).toBeNull();
  });
});
