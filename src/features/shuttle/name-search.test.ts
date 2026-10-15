import { describe, expect, it } from "vitest";

import { matchesName } from "./name-search";

describe("matchesName — 아이 이름 검색", () => {
  it("빈 검색어는 모두 맞다", () => {
    expect(matchesName("김민준", "")).toBe(true);
    expect(matchesName("김민준", "  ")).toBe(true);
  });

  it("글자 일부로 찾는다(띄어쓰기 무시)", () => {
    expect(matchesName("김민준", "민준")).toBe(true);
    expect(matchesName("김민준", "김 민")).toBe(true);
    expect(matchesName("김민준", "서연")).toBe(false);
  });

  it("초성으로, 또는 글자·초성 섞어서 찾는다", () => {
    expect(matchesName("김민준", "ㄱㅁㅈ")).toBe(true);
    expect(matchesName("김민준", "ㅁㅈ")).toBe(true);
    expect(matchesName("김민준", "김ㅁ")).toBe(true);
    expect(matchesName("김민준", "ㅇㅅㅇ")).toBe(false);
    expect(matchesName("김민준", "ㄱㅁㅈㅈ")).toBe(false);
  });
});
