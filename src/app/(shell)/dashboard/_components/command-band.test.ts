import { describe, expect, it } from "vitest";
import { formatOutstandingAmount } from "./command-band";

describe("formatOutstandingAmount", () => {
  it("1만원 미만의 실제 잔액을 0만원으로 반올림하지 않는다", () => {
    expect(formatOutstandingAmount(4_900)).toEqual({ value: "4,900", unit: "원" });
  });

  it("만원 이상은 소수 한 자리까지 보존한다", () => {
    expect(formatOutstandingAmount(15_000)).toEqual({ value: "1.5", unit: "만원" });
  });
});
