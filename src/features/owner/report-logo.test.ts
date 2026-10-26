import { describe, expect, it } from "vitest";
import { reportLogoPath } from "./report-logo";

describe("reportLogoPath", () => {
  it("보고서 전용 로고가 있으면 그것을 쓴다", () => {
    expect(reportLogoPath({ profile: { logoUrl: "a.png" }, report: { logoUrl: "b.png" } })).toBe("b.png");
  });
  it("비었거나 공백·옛 설정(키 없음)이면 학원 로고", () => {
    expect(reportLogoPath({ profile: { logoUrl: "a.png" }, report: { logoUrl: "  " } })).toBe("a.png");
    expect(reportLogoPath({ profile: { logoUrl: "a.png" }, report: {} })).toBe("a.png");
  });
});
