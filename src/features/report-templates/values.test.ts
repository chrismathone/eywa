import { describe, expect, it } from "vitest";
import { BUILTIN_ENGLISH_TEMPLATE, ENGLISH_TEMPLATE_TOKEN_KEYS } from "./defaults";
import { fillReportTemplate } from "./fill";
import { englishTemplateValues } from "./values";

const BASE = {
  studentName: "공서연",
  teacherName: "정유진",
  progress: "Unit 1~3 리뷰",
  homeworkToday: "Work Book p.30~33",
  tests: { daily: "20문제 중 18개 맞음", check: "" },
  nextTest: "단어 시험 71~80번",
  aiIntro: "밝게 참여했습니다.",
  aiComment: "서연이가 구문을 잘 찾았습니다.",
};

describe("englishTemplateValues", () => {
  it("토큰 목록의 키를 전부 채운다(빠진 키 = 모르는 토큰 = 그 줄이 조용히 빠짐)", () => {
    expect(Object.keys(englishTemplateValues(BASE)).sort()).toEqual([...ENGLISH_TEMPLATE_TOKEN_KEYS].sort());
  });

  it("작성자는 '이름 선생님', 이름이 비면 빈 값", () => {
    expect(englishTemplateValues(BASE).작성자).toBe("정유진 선생님");
    expect(englishTemplateValues({ ...BASE, teacherName: " " }).작성자).toBe("");
  });

  it("테스트는 있는 것만 라벨을 붙여 잇는다", () => {
    expect(englishTemplateValues(BASE).테스트).toBe("일일 20문제 중 18개 맞음");
    expect(
      englishTemplateValues({ ...BASE, tests: { daily: "20문제 중 18개 맞음", check: "10문제 중 9개 맞음" } }).테스트,
    ).toBe("일일 20문제 중 18개 맞음 / 확인 10문제 중 9개 맞음");
    expect(englishTemplateValues({ ...BASE, tests: { daily: "", check: "" } }).테스트).toBe("");
  });

  it("기본 템플릿에 넣으면 모르는 토큰이 없다", () => {
    const r = fillReportTemplate(BUILTIN_ENGLISH_TEMPLATE.body, englishTemplateValues(BASE));
    expect(r.unknownTokens).toEqual([]);
    expect(r.text).toContain("안녕하세요 학부모님, 정유진 선생님입니다!");
    expect(r.text).toContain("테스트 : 일일 20문제 중 18개 맞음");
  });
});
