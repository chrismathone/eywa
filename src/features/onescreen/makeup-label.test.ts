import { describe, expect, it } from "vitest";
import {
  MAKEUP_COMBINED_SUFFIX,
  MAKEUP_ONLY_SUFFIX,
  makeupBadgeLabel,
  makeupTitleSuffix,
} from "./makeup-label";

describe("makeupTitleSuffix", () => {
  it("보강이 아니면 접미사가 없다", () => {
    expect(makeupTitleSuffix({ makeup: false, hasClass: true })).toBe("");
    expect(makeupTitleSuffix({})).toBe("");
    expect(makeupTitleSuffix({ makeup: null, hasClass: false })).toBe("");
  });

  it("반이 없는 보강 행 = 보강만", () => {
    expect(makeupTitleSuffix({ makeup: true, hasClass: false })).toBe(MAKEUP_ONLY_SUFFIX);
    // hasClass 미상(undefined)도 보강만으로 — 모르면 더 좁은 주장을 한다(정규까지 했다고 단정하지 않는다).
    expect(makeupTitleSuffix({ makeup: true })).toBe(MAKEUP_ONLY_SUFFIX);
  });

  it("반이 붙은 보강 행 = 정규+보강", () => {
    expect(makeupTitleSuffix({ makeup: true, hasClass: true })).toBe(MAKEUP_COMBINED_SUFFIX);
  });

  it("접미사는 앞 공백을 포함해 제목에 그대로 이어붙는다", () => {
    expect(`수업 보고서${makeupTitleSuffix({ makeup: true, hasClass: true })}`).toBe(
      "수업 보고서 (정규+보강)",
    );
    expect(`수업 보고서${makeupTitleSuffix({ makeup: true, hasClass: false })}`).toBe("수업 보고서 (보강)");
  });
});

describe("makeupBadgeLabel", () => {
  it("배지는 괄호 없이 — 보강이 아니면 null", () => {
    expect(makeupBadgeLabel({ makeup: false })).toBeNull();
    expect(makeupBadgeLabel({ makeup: true, hasClass: false })).toBe("보강");
    expect(makeupBadgeLabel({ makeup: true, hasClass: true })).toBe("정규+보강");
  });
});
