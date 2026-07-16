import { describe, it, expect } from "vitest";
import {
  currencyDecimals,
  formatMoney,
  moneyStep,
  roundMoney,
} from "./currencies";

describe("currencyDecimals", () => {
  it("원·엔은 0자리, 달러·유로 등은 2자리", () => {
    expect(currencyDecimals("KRW")).toBe(0);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("GBP")).toBe(2);
  });
  it("미등록 코드는 기본 통화(원=0) 기준", () => {
    expect(currencyDecimals("XYZ")).toBe(0);
  });
});

describe("roundMoney", () => {
  it("달러는 센트(2자리)로 반올림 — $10.6은 그대로 보존(정수화 안 됨)", () => {
    expect(roundMoney(10.6, "USD")).toBe(10.6);
    expect(roundMoney(10.605, "USD")).toBe(10.61);
    expect(roundMoney(10.604, "USD")).toBe(10.6);
  });
  it("원은 정수로 반올림", () => {
    expect(roundMoney(10.6, "KRW")).toBe(11);
    expect(roundMoney(10.4, "KRW")).toBe(10);
  });
  it("부동소수 누적오차를 흡수 — $0.1 + $0.2 = $0.30", () => {
    expect(roundMoney(0.1 + 0.2, "USD")).toBe(0.3);
  });
  it("1.005*100의 이진 표현 오차를 보정해 올림", () => {
    expect(roundMoney(1.005, "USD")).toBe(1.01);
  });
  it("비수치·NaN은 0", () => {
    expect(roundMoney(NaN, "USD")).toBe(0);
    expect(roundMoney(Infinity, "KRW")).toBe(0);
  });
});

describe("moneyStep", () => {
  it("원=1, 달러=0.01 (소수 입력 허용)", () => {
    expect(moneyStep("KRW")).toBe("1");
    expect(moneyStep("USD")).toBe("0.01");
    expect(moneyStep("EUR")).toBe("0.01");
  });
});

describe("formatMoney", () => {
  it("통화 정밀도로 자릿수 고정 표기", () => {
    expect(formatMoney(10.6, "USD")).toBe("$10.60");
    expect(formatMoney(1000, "KRW")).toBe("₩1,000");
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
  });
});
