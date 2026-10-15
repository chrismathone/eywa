import { describe, expect, it } from "vitest";
import { scopeText, spanText } from "./scope-text";

describe("퇴원관리 수치 범위 문구(원장 2026-09-29)", () => {
  it("필터가 없으면 학원 전체", () => {
    expect(scopeText({})).toBe("학원 전체");
  });
  it("걸린 필터를 모두 밝힌다", () => {
    expect(scopeText({ program: "수학", reason: "이사", q: "김" })).toBe("수학만 · 사유 이사 · '김' 검색");
    expect(scopeText({ early: "1개월 이내" })).toBe("등록 후 1개월 이내 퇴원");
  });
  it("기간 = 같은 해면 월/일, 해가 다르면 연도", () => {
    expect(spanText("2026-01-01", "2026-09-29")).toBe("1/1 ~ 9/29");
    expect(spanText("2025-10-01", "2026-09-29")).toBe("2025.10/1 ~ 2026.9/29");
  });
});
