import { describe, it, expect } from "vitest";
import { hasMentText } from "./ment-text.mjs";
import { hasTextBesidesMarkers } from "../../src/features/report-templates/image-slots";

const CASES = [
  "",
  "   \n  ",
  "[시험결과지]",
  "[ 학습분석지 ]\n\n[시험결과지]",
  "[첨부: image.jpg]",
  "[첨부： 보카킹 결과.png]\n[시험결과지]",
  "오늘 수업 잘 했습니다.",
  "안녕하세요\n[시험결과지]\n감사합니다",
  "[첨부: a.jpg] 설명",
  "[시험결과지] 참고",
];

describe("hasMentText — 워커 빈 멘트 가드", () => {
  it("자리 줄뿐이면 빈 멘트", () => {
    expect(hasMentText("[시험결과지]\n\n[첨부: a.png]")).toBe(false);
    expect(hasMentText(null)).toBe(false);
  });
  it("글이 한 줄이라도 있으면 통과", () => {
    expect(hasMentText("민수가 오늘 단어시험 만점!\n[시험결과지]")).toBe(true);
  });
  it("앱 판정(hasTextBesidesMarkers)과 같은 답", () => {
    for (const c of CASES) expect(hasMentText(c)).toBe(hasTextBesidesMarkers(c));
  });
});
