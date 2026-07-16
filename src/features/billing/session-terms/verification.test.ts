import { describe, it, expect } from "vitest";
import { classifyVerification } from "./verification";

describe("classifyVerification", () => {
  it("미확정: confirmed=null → unconfirmed, diff null (실측 무관)", () => {
    expect(classifyVerification(null, 0)).toEqual({ status: "unconfirmed", diff: null });
    expect(classifyVerification(null, 8)).toEqual({ status: "unconfirmed", diff: null });
  });

  it("일치: 실측 == 확정 → matched, diff 0", () => {
    expect(classifyVerification(8, 8)).toEqual({ status: "matched", diff: 0 });
    expect(classifyVerification(0, 0)).toEqual({ status: "matched", diff: 0 });
  });

  it("부족: 실측 < 확정 → short, diff 음수(과청구 점검)", () => {
    expect(classifyVerification(8, 6)).toEqual({ status: "short", diff: -2 });
    expect(classifyVerification(4, 0)).toEqual({ status: "short", diff: -4 });
  });

  it("초과: 실측 > 확정 → over, diff 양수(미청구 점검)", () => {
    expect(classifyVerification(8, 10)).toEqual({ status: "over", diff: 2 });
    expect(classifyVerification(0, 3)).toEqual({ status: "over", diff: 3 });
  });

  it("확정 0 vs 실측 0 = 일치(0회 확정도 검증 대상, null과 구분)", () => {
    expect(classifyVerification(0, 0).status).toBe("matched");
    expect(classifyVerification(null, 0).status).toBe("unconfirmed");
  });

  it("배수 시수(소수 실측) — 12.5 vs 12 = over +0.5, 11.5 vs 12 = short -0.5", () => {
    expect(classifyVerification(12, 12.5)).toEqual({ status: "over", diff: 0.5 });
    expect(classifyVerification(12, 11.5)).toEqual({ status: "short", diff: -0.5 });
  });

  it("부동소수 잔차 방어 — 0.5×3 합(1.5000000000000002류)이 가짜 불일치를 안 만든다", () => {
    expect(classifyVerification(1.5, 0.5 + 0.5 + 0.5)).toEqual({ status: "matched", diff: 0 });
    expect(classifyVerification(3, 0.1 + 0.2 + 2.7)).toEqual({ status: "matched", diff: 0 });
  });
});
