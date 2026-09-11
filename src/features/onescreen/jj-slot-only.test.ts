import { describe, expect, it } from "vitest";
import { isSlotOnlyEnglishNotes } from "./jj-capture-plan";

describe("isSlotOnlyEnglishNotes — 자리 줄뿐인 영어 글은 보내지 않는다", () => {
  it("그림 자리 줄뿐이면 참", () => {
    expect(isSlotOnlyEnglishNotes("english", "[시험결과지]")).toBe(true);
    expect(isSlotOnlyEnglishNotes("english", "\n[시험결과지]\n\n[학습분석지]\n")).toBe(true);
  });

  it("첨부 자리 줄뿐이어도 참(사진·PDF만 있고 글자 0)", () => {
    expect(isSlotOnlyEnglishNotes("english", "[첨부: 시험지.jpg]")).toBe(true);
    expect(isSlotOnlyEnglishNotes("english", "[시험결과지]\n\n[첨부: a.pdf]")).toBe(true);
  });

  it("글이 한 줄이라도 있으면 거짓", () => {
    expect(isSlotOnlyEnglishNotes("english", "안녕하세요\n[시험결과지]")).toBe(false);
    expect(isSlotOnlyEnglishNotes("english", "안녕하세요\n[첨부: 시험지.jpg]")).toBe(false);
  });

  it("자리 줄이 없는 빈 글·수학은 이 판정 밖(종전 경로 그대로)", () => {
    expect(isSlotOnlyEnglishNotes("english", "")).toBe(false);
    expect(isSlotOnlyEnglishNotes("english", null)).toBe(false);
    expect(isSlotOnlyEnglishNotes("math", "[시험결과지]")).toBe(false);
    expect(isSlotOnlyEnglishNotes("math", "[첨부: a.jpg]")).toBe(false);
  });
});
