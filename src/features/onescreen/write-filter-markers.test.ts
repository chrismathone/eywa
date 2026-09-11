import { describe, expect, it } from "vitest";
import { isRowWritten } from "./write-filter";

describe("isRowWritten — 영어 글의 그림·사진 자리 줄", () => {
  it("🔑 자리 줄뿐인 글은 저장됐어도 '미작성'(사진부터 넣으면 첨부가 먼저 저장한다)", () => {
    expect(isRowWritten({ sent: true, draft: "[첨부: 시험지.jpg]" })).toBe(false);
    expect(isRowWritten({ sent: false, draft: "[시험결과지]\n\n[첨부: a.pdf]" })).toBe(false);
  });

  it("글이 있으면 작성 · 자리 줄이 없는 글은 예전 판정 그대로(저장됐으면 작성)", () => {
    expect(isRowWritten({ sent: true, draft: "안녕하세요\n[첨부: 시험지.jpg]" })).toBe(true);
    expect(isRowWritten({ sent: false, draft: "안녕하세요" })).toBe(true);
    expect(isRowWritten({ sent: true, draft: "" })).toBe(true);
    expect(isRowWritten({ sent: true, draft: null })).toBe(true);
    expect(isRowWritten({ sent: false, draft: "   " })).toBe(false);
  });
});
