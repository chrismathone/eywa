import { describe, expect, it } from "vitest";
import { maskResidentNo } from "./pii-mask";

describe("주민번호 가림 — 앞 6자리 + 뒷자리 첫 자리만(원장 2026-11-11)", () => {
  it("줄표 · 줄표 없이 · 띄어 · 긴 줄표 · 전각", () => {
    expect(maskResidentNo("891003-1234567")).toBe("891003-1******");
    expect(maskResidentNo("주민번호 8910031234567 입니다")).toBe("주민번호 891003-1****** 입니다");
    expect(maskResidentNo("891003 1234567")).toBe("891003-1******");
    expect(maskResidentNo("891003 - 2234567")).toBe("891003-2******");
    expect(maskResidentNo("891003–1234567")).toBe("891003-1******");
    expect(maskResidentNo("８９１００３－１２３４５６７")).toBe("８９１００３-１******");
    expect(maskResidentNo('{"personal":{"residentId":"891003-1234567"}}')).toBe('{"personal":{"residentId":"891003-1******"}}');
    for (const s of ["891003−1234567", "891003.1234567", "891003·1234567", "891003/1234567", "891003\n1234567", "891003\u00A01234567", "891003\u200B-1234567"]) {
      expect(maskResidentNo(s)).toBe("891003-1******");
    }
  });
  it("주민번호가 아닌 것은 그대로 — 전화 · 날짜 · 계좌 · 소수 · 긴 숫자 · 생년월일이 아닌 앞자리", () => {
    for (const s of ["010-1234-5678", "2026-10-01", "110-123-456789", "0.0891003412345678", "12345678910031234567", "991399-1234567", "891003-9234567", "891003-123456"]) {
      expect(maskResidentNo(s)).toBe(s);
    }
  });
});
