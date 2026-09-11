import { describe, expect, it } from "vitest";
import { englishFactsKey, textHash } from "./provenance";

const F = {
  progress: "Unit 3",
  testText: "일일 20문제 중 18개 맞음",
  homeworkToday: "WB p.30",
  nextTest: "단어 71~80",
  attitude: "적극적",
  homework: "90%",
  specialNote: "",
};

describe("textHash", () => {
  it("같은 글이면 같고, 한 글자라도 다르면 다르다", () => {
    expect(textHash("안녕하세요")).toBe(textHash("안녕하세요"));
    expect(textHash("안녕하세요")).not.toBe(textHash("안녕하세요!"));
    expect(textHash("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("englishFactsKey", () => {
  it("점수가 바뀌면 지문이 바뀐다", () => {
    expect(englishFactsKey(F)).not.toBe(englishFactsKey({ ...F, testText: "일일 20문제 중 15개 맞음" }));
  });
  it("공백 차이는 같은 사실로 본다", () => {
    expect(englishFactsKey(F)).toBe(englishFactsKey({ ...F, progress: "  Unit   3 " }));
  });
  it("칸 경계가 섞이지 않는다", () => {
    expect(englishFactsKey({ ...F, progress: "ab", testText: "c" })).not.toBe(
      englishFactsKey({ ...F, progress: "a", testText: "bc" }),
    );
  });
});
