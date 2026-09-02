import { describe, expect, it } from "vitest";
import { isValidAssetCode, nextAssetCode, normalizeAssetCode } from "./asset-code";

describe("자산ID 채번", () => {
  it("접두의 최대 번호 + 1, 3자리", () => {
    expect(nextAssetCode("laptop", ["NB-001", "NB-018", "DT-044"])).toBe("NB-019");
    expect(nextAssetCode("desktop", [])).toBe("DT-001");
  });
  it("번호가 아닌 꼬리(MN-5A)·소문자는 건너뛰거나 정규화한다", () => {
    expect(nextAssetCode("monitor", ["MN-5A", "mn-003"])).toBe("MN-004");
  });
  it("999를 넘으면 4자리로 늘어난다(자르지 않는다)", () => {
    expect(nextAssetCode("tv", ["TV-999"])).toBe("TV-1000");
  });
  it("형식 검증 — 대문자·숫자·하이픈 2~32자", () => {
    expect(isValidAssetCode("NB-002")).toBe(true);
    expect(isValidAssetCode(normalizeAssetCode(" nb-002 "))).toBe(true);
    expect(isValidAssetCode("-NB")).toBe(false);
    expect(isValidAssetCode("N")).toBe(false);
    expect(isValidAssetCode("NB 002")).toBe(false);
  });
});
