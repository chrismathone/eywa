import { describe, expect, it } from "vitest";
import { ijwIdCore, ijwIdMatchesName, romanInitialSets } from "./romanize";

describe("romanInitialSets", () => {
  it("공서연 → gsy·ksy", () => {
    const s = romanInitialSets("공서연");
    expect(s).toContain("gsy");
    expect(s).toContain("ksy");
  });

  it("흔한 성 표기를 허용한다(이 Lee/Yi · 박 Park)", () => {
    expect(romanInitialSets("이민준")).toEqual(expect.arrayContaining(["imj", "ymj", "lmj"]));
    expect(romanInitialSets("박소희")).toEqual(expect.arrayContaining(["bsh", "psh"]));
  });

  it("한글이 없으면 빈 배열", () => {
    expect(romanInitialSets("Kevin")).toEqual([]);
    expect(romanInitialSets("")).toEqual([]);
  });
});

describe("ijwIdMatchesName", () => {
  it("설명서 예시 — ijwgsy ↔ 공서연", () => {
    expect(ijwIdMatchesName("ijwgsy", "공서연")).toBe(true);
  });

  it("숫자 꼬리·대문자는 무시", () => {
    expect(ijwIdCore("IJWgsy2")).toBe("gsy");
    expect(ijwIdMatchesName("IJWgsy2", "공서연")).toBe(true);
  });

  it("🔴 머리글자가 같은 다른 학생도 걸린다 — 그래서 후보로만 쓴다", () => {
    expect(ijwIdMatchesName("ijwgsy", "김서윤")).toBe(true);
  });

  it("안 맞으면 false, 두 글자 미만 아이디는 비교하지 않는다", () => {
    expect(ijwIdMatchesName("ijwabc", "공서연")).toBe(false);
    expect(ijwIdMatchesName("ijwg", "공")).toBe(false);
  });
});
