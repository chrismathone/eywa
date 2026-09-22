import { describe, expect, it } from "vitest";
import {
  applyRatePenalty,
  resolvePenaltyPoints,
  computePayslipAmounts,
  lastDayOfMonth,
  payDateLabel,
  periodTitle,
  rateBreakdownLabel,
  workPeriodLabel,
  WITHHOLDING_RATE,
} from "./payslip";

/**
 * 골든마스터 — 원장 시트(문서 1Uh7mbje…) 실측치.
 * 이 숫자가 깨지면 **테스트를 고치기 전에 "왜 달라졌는지" 설명이 먼저다**(돈 산식 규율).
 */
describe("명세서 금액 — 시트 실측 재현", () => {
  it("명세서 탭(김은정 2026-07): 3,160,062 → 소득세 104,282 · 실수령 3,055,780", () => {
    const a = computePayslipAmounts({ tuition: 3_160_062 });
    expect(a.grossPay).toBe(3_160_062);
    expect(a.withholding).toBe(104_282); // 시트 104282.046 → 통화 서식 104,282
    expect(a.netPay).toBe(3_055_780); // 시트 3055779.954 → 3,055,780
    expect(a.deductionTotal).toBe(104_282);
    // 신고용 분해는 합이 정확히 원천징수와 같아야 한다
    expect(a.incomeTax + a.localTax).toBe(a.withholding);
    expect(a.incomeTax).toBe(94_802);
    expect(a.localTax).toBe(9_480);
  });

  /**
   * 소득세신고 탭 7행. 시트의 지급액은 소수(3,181,051.436)지만 aywa 정산액은 **정수**라
   * (computeTierSettlement이 Math.floor로 끝낸다) 정수 기준으로 대조한다.
   * 기대값 = 시트의 차인지급액을 정수 지급액에 맞춰 재계산한 값.
   */
  it.each([
    ["김은정", 3_181_049, 3_076_074],
    ["김화영", 740_316, 715_886],
    ["김윤하", 3_320_389, 3_210_816],
    ["이수진", 5_506_397, 5_324_686],
    ["김민주", 3_794_235, 3_669_025],
    ["강보경", 536_772, 519_059],
    ["추민아", 3_949_481, 3_819_148],
  ])("소득세신고 탭(%s): %i → 실수령 %i", (_name, gross, expectedNet) => {
    const a = computePayslipAmounts({ tuition: gross });
    expect(a.netPay).toBe(expectedNet);
    expect(a.netPay).toBe(gross - a.withholding);
    expect(a.incomeTax + a.localTax).toBe(a.withholding);
  });

  it("기타공제는 과세표준을 먼저 줄인다 (시트 D9 수식)", () => {
    const a = computePayslipAmounts({ tuition: 1_000_000, otherDeduction: 100_000 });
    expect(a.taxableBase).toBe(900_000);
    expect(a.withholding).toBe(Math.round(900_000 * WITHHOLDING_RATE)); // 29,700
    expect(a.deductionTotal).toBe(100_000 + 29_700);
    expect(a.netPay).toBe(1_000_000 - 129_700);
  });

  it("인센티브는 지급총액에 더해지고 과세된다", () => {
    const a = computePayslipAmounts({ tuition: 1_000_000, incentive: 200_000 });
    expect(a.grossPay).toBe(1_200_000);
    expect(a.taxableBase).toBe(1_200_000);
    expect(a.netPay).toBe(1_200_000 - a.withholding);
  });

  it("분해 합계는 어떤 금액에서도 원천징수와 정확히 일치한다", () => {
    for (let g = 0; g <= 10_000_000; g += 7_919) {
      const a = computePayslipAmounts({ tuition: g });
      expect(a.incomeTax + a.localTax).toBe(a.withholding);
      expect(a.netPay).toBe(a.grossPay - a.deductionTotal);
      expect(a.netPay).toBeGreaterThanOrEqual(0);
    }
  });

  it("음수·null 입력은 0으로 눌러 실수령이 마이너스가 되지 않는다", () => {
    const a = computePayslipAmounts({ tuition: -5, incentive: null, otherDeduction: null });
    expect(a.grossPay).toBe(0);
    expect(a.netPay).toBe(0);
  });

  it("기타공제가 지급총액보다 커도 과세표준은 0에서 멈춘다", () => {
    const a = computePayslipAmounts({ tuition: 100_000, otherDeduction: 500_000 });
    expect(a.taxableBase).toBe(0);
    expect(a.withholding).toBe(0);
  });
});

describe("기간·날짜 라벨 — 시트 수식 그대로", () => {
  it("근무기간 = yy.MM.01-말일", () => {
    expect(workPeriodLabel("2026-07")).toBe("26.07.01-31");
    expect(workPeriodLabel("2026-02")).toBe("26.02.01-28");
    expect(workPeriodLabel("2024-02")).toBe("24.02.01-29"); // 윤년
    expect(workPeriodLabel("2026-09")).toBe("26.09.01-30");
  });

  it("말일", () => {
    expect(lastDayOfMonth("2026-01")).toBe(31);
    expect(lastDayOfMonth("2026-04")).toBe(30);
  });

  it("지급일 = 다음 달 10일 (연말은 해가 넘어간다)", () => {
    expect(payDateLabel("2026-07")).toBe("2026.08.10");
    expect(payDateLabel("2026-12")).toBe("2027.01.10");
  });

  it("제목 연월", () => {
    expect(periodTitle("2026-07")).toBe("2026년 07월");
  });

  it("잘못된 기간은 null (호출부가 판단하게 — 지어내지 않는다)", () => {
    for (const bad of ["2026-13", "2026-00", "26-07", "2026/07", "", "abcd-ef"]) {
      expect(workPeriodLabel(bad)).toBeNull();
      expect(payDateLabel(bad)).toBeNull();
      expect(periodTitle(bad)).toBeNull();
    }
  });
});

describe("블로그 미작성 패널티 — 포인트(%p) 차감", () => {
  it("2026-08 시트 역산과 일치: 전 과정 균일 −2.0%p", () => {
    // 김윤하 45→43 · 48→46 / 이수진 45→43 · 47.5→45.5 · 50→48
    expect(applyRatePenalty(45, 2)).toBe(43);
    expect(applyRatePenalty(48, 2)).toBe(46);
    expect(applyRatePenalty(47.5, 2)).toBe(45.5);
    expect(applyRatePenalty(50, 2)).toBe(48);
  });

  it("비율(%) 곱이 아니라 포인트(%p) 뺄셈이다", () => {
    expect(applyRatePenalty(45, 2)).not.toBeCloseTo(45 * 0.98); // 44.1이 아니다
  });

  it("0 아래로 내려가지 않는다", () => {
    expect(applyRatePenalty(1, 5)).toBe(0);
  });

  it("패널티 0이면 비율만 표시", () => {
    expect(rateBreakdownLabel(47.5, 0)).toBe("47.5%");
  });

  it("패널티가 있으면 기본·차감·적용을 모두 밝힌다", () => {
    expect(rateBreakdownLabel(45, 2)).toBe("기본 45% · 블로그 미작성 −2%p · 적용 43%");
    expect(rateBreakdownLabel(47.5, 2)).toBe("기본 47.5% · 블로그 미작성 −2%p · 적용 45.5%");
  });
});

/**
 * 🔴 이 규칙이 뒤집히면 **매달 과소지급**이 난다(적대 리뷰가 잡은 치명 버그의 회귀 가드).
 * 저장값이 프리필된 상태에서 체크만 풀어도 차감이 0이 되어야 한다.
 */
describe("차감 포인트 우선순위 — 체크박스가 1차 컨트롤", () => {
  it("체크를 풀면 숫자 칸에 뭐가 있어도 0이다", () => {
    expect(resolvePenaltyPoints(false, "2")).toEqual({ points: 0 });
    expect(resolvePenaltyPoints(false, "99")).toEqual({ points: 0 });
    expect(resolvePenaltyPoints(false, "")).toEqual({ points: 0 });
  });

  it("체크 + 빈 칸 = 관행값 −2%p", () => {
    expect(resolvePenaltyPoints(true, "")).toEqual({ points: 2 });
    expect(resolvePenaltyPoints(true, "   ")).toEqual({ points: 2 });
  });

  it("체크 + 값 = 그 값(소수 한 자리까지)", () => {
    expect(resolvePenaltyPoints(true, "3")).toEqual({ points: 3 });
    expect(resolvePenaltyPoints(true, "1.5")).toEqual({ points: 1.5 });
    expect(resolvePenaltyPoints(true, "2.25")).toEqual({ points: 2.3 });
  });

  it("범위 밖·비숫자는 조용히 고치지 않고 거부한다", () => {
    for (const bad of ["-1", "101", "abc"]) {
      expect(resolvePenaltyPoints(true, bad).error).toBeTruthy();
      expect(resolvePenaltyPoints(true, bad).points).toBeUndefined();
    }
  });

  it("체크 해제는 잘못된 값이어도 거부하지 않는다(어차피 0)", () => {
    expect(resolvePenaltyPoints(false, "abc")).toEqual({ points: 0 });
  });
});
