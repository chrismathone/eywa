import { describe, expect, it } from "vitest";
import {
  PMODE_UNSET,
  PRICING_MODES,
  PRICING_MODE_EFFECT,
  isClassPricingMode,
  normalizePricingMode,
  pricingModeLabel,
} from "./tuition-catalog";

describe("단가 종류(pricing_mode)", () => {
  it("아는 값만 라벨을 주고, 나머지는 '미지정'", () => {
    expect(pricingModeLabel("per_session")).toBe("회당 단가");
    expect(pricingModeLabel("monthly")).toBe("월 단가");
    expect(pricingModeLabel("extra")).toBe("기타비용");
    expect(pricingModeLabel("discount")).toBe("할인액");
    expect(pricingModeLabel(null)).toBe("미지정");
    expect(pricingModeLabel("아무거나")).toBe("미지정"); // raw 값이 화면에 새지 않는다
  });

  /**
   * 🔴 `PMODE_UNSET`은 **URL 필터 키**이지 저장값이 아니다. 정규화가 이걸 통과시키면 DB에 "none"이라는
   *    문자열이 저장되고, 그 행은 미지정도 아니고 아는 종류도 아닌 **유령**이 된다(어떤 필터에도 안 잡힌다).
   */
  it("필터 키 'none'은 저장값으로 승격되지 않는다", () => {
    expect(normalizePricingMode(PMODE_UNSET)).toBeNull();
    // (타입상 겹치지 않는다는 것 자체가 방어의 일부라, 값 비교는 넓은 타입으로 확인한다.)
    expect((PRICING_MODES as readonly { value: string }[]).some((m) => m.value === PMODE_UNSET)).toBe(false);
  });

  it("빈 값·공백·모르는 값은 전부 미지정(null)", () => {
    expect(normalizePricingMode("")).toBeNull();
    expect(normalizePricingMode("   ")).toBeNull();
    expect(normalizePricingMode(undefined)).toBeNull();
    expect(normalizePricingMode("monthly ")).toBe("monthly"); // 앞뒤 공백은 다듬는다
  });

  /**
   * 🔴 **수업 단가는 회당·월 둘뿐이다.** 기타비용·할인은 수업이 아니라서, 이 판정이 느슨해지면
   *    셔틀버스비가 수강 과목 자리에 앉거나 수납 '회차 확정'의 단가 후보로 올라온다.
   */
  it("수업 단가는 회당·월뿐 — 기타비용·할인은 아니다", () => {
    expect(isClassPricingMode("per_session")).toBe(true);
    expect(isClassPricingMode("monthly")).toBe(true);
    expect(isClassPricingMode("extra")).toBe(false);
    expect(isClassPricingMode("discount")).toBe(false);
    expect(isClassPricingMode(null)).toBe(false);
  });

  it("'기타비용'은 저장 가능한 값이다(DB CHECK도 0192a에서 넓혔다)", () => {
    expect(normalizePricingMode("extra")).toBe("extra");
  });

  // 단가표와 계산기가 서로 다른 말을 쓰므로(여긴 '월 단가', 저긴 '월 고정') 연결을 화면에 적는다.
  // 종류를 새로 추가하면 이 설명도 함께 채워야 한다(빠지면 화면에 빈 툴팁이 뜬다).
  it("모든 종류에 '계산기에서 무엇이 되는지' 설명이 있다", () => {
    for (const m of PRICING_MODES) {
      expect(PRICING_MODE_EFFECT[m.value]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
