import { describe, it, expect } from "vitest";
import { breakIntoSentences, splitSentences } from "./split-sentences";

describe("splitSentences", () => {
  it("종결부호+공백에서 문장 분리(한국어)", () => {
    expect(splitSentences("회의를 시작합니다. 안건은 두 가지예요. 첫째는 예산이죠.")).toEqual([
      "회의를 시작합니다.",
      "안건은 두 가지예요.",
      "첫째는 예산이죠.",
    ]);
  });

  it("소수점·퍼센트는 안 쪼갬(공백 없음)", () => {
    expect(splitSentences("1.9까지의 수의 순서를 배웠고 정답률은 99%였어요.")).toEqual([
      "1.9까지의 수의 순서를 배웠고 정답률은 99%였어요.",
    ]);
  });

  it("물음표·느낌표도 경계", () => {
    expect(splitSentences("이거 되나요? 네 됩니다! 좋아요.")).toEqual([
      "이거 되나요?",
      "네 됩니다!",
      "좋아요.",
    ]);
  });

  it("종결부호 없으면 통째로 한 문장", () => {
    expect(splitSentences("부호 없는 긴 발화 한 덩어리")).toEqual(["부호 없는 긴 발화 한 덩어리"]);
  });

  it("breakIntoSentences는 개행으로 합침", () => {
    expect(breakIntoSentences("가. 나. 다.")).toBe("가.\n나.\n다.");
  });

  it("빈 문자열·공백만이면 빈 배열", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});
