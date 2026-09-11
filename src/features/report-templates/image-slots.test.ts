import { describe, expect, it } from "vitest";
import { imageSlotOfLine, splitImageSlots, stripImageSlots, usedImageSlots } from "./image-slots";

const BODY = [
  "안녕하세요 학부모님!",
  "",
  "📍 오늘의 진도",
  "Unit 3",
  "",
  "[시험결과지]",
  "",
  "💌 코멘트",
  "잘했어요",
  "[학습분석지]",
].join("\n");

describe("imageSlotOfLine", () => {
  it("줄 전체가 표식일 때만 자리다", () => {
    expect(imageSlotOfLine("[시험결과지]")).toBe("시험결과지");
    expect(imageSlotOfLine("  [ 학습분석지 ]  ")).toBe("학습분석지");
    expect(imageSlotOfLine("오늘 [시험결과지]를 보세요")).toBeNull();
    expect(imageSlotOfLine("[진도]")).toBeNull();
  });
});

describe("splitImageSlots", () => {
  it("글 조각과 그림 자리를 나온 순서대로 나눈다", () => {
    expect(splitImageSlots(BODY)).toEqual([
      { kind: "text", text: "안녕하세요 학부모님!\n\n📍 오늘의 진도\nUnit 3" },
      { kind: "slot", key: "시험결과지" },
      { kind: "text", text: "💌 코멘트\n잘했어요" },
      { kind: "slot", key: "학습분석지" },
    ]);
  });

  it("자리가 없으면 글 한 조각 · 빈 글은 조각 없음", () => {
    expect(splitImageSlots("한 줄")).toEqual([{ kind: "text", text: "한 줄" }]);
    expect(splitImageSlots("  \n ")).toEqual([]);
    expect(splitImageSlots(null)).toEqual([]);
  });

  it("CRLF도 같은 결과", () => {
    expect(splitImageSlots("가\r\n[학습분석지]\r\n나")).toEqual([
      { kind: "text", text: "가" },
      { kind: "slot", key: "학습분석지" },
      { kind: "text", text: "나" },
    ]);
  });
});

describe("stripImageSlots", () => {
  it("자리 줄을 지우고 빈 줄 겹침을 한 번으로 접는다", () => {
    expect(stripImageSlots(BODY)).toBe("안녕하세요 학부모님!\n\n📍 오늘의 진도\nUnit 3\n\n💌 코멘트\n잘했어요");
  });

  it("문장 속 표식은 그대로 둔다", () => {
    expect(stripImageSlots("오늘 [시험결과지] 참고")).toBe("오늘 [시험결과지] 참고");
  });

  it("자리가 없는 곳의 빈 줄은 강사가 띄운 그대로 둔다", () => {
    expect(stripImageSlots("가\n\n\n\n나")).toBe("가\n\n\n\n나");
    expect(stripImageSlots("가\n\n\n나\n\n[학습분석지]\n\n다")).toBe("가\n\n\n나\n\n다");
  });

  it("자리가 연달아 있거나 글 맨 앞·끝이어도 간격이 두 겹이 되지 않는다", () => {
    expect(stripImageSlots("가\n\n[시험결과지]\n\n[학습분석지]\n\n나")).toBe("가\n\n나");
    expect(stripImageSlots("[시험결과지]\n\n가")).toBe("가");
    expect(stripImageSlots("가\n\n[학습분석지]\n")).toBe("가");
    expect(stripImageSlots("가\n[학습분석지]\n나")).toBe("가\n나");
  });
});

describe("usedImageSlots", () => {
  it("나온 순서 · 중복 제거", () => {
    expect(usedImageSlots(`${BODY}\n[시험결과지]`)).toEqual(["시험결과지", "학습분석지"]);
    expect(usedImageSlots("그림 없음")).toEqual([]);
  });
});
