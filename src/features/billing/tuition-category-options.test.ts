import { describe, expect, it } from "vitest";
import { tuitionCategoryOptions } from "./tuition-catalog";

describe("tuitionCategoryOptions — 수강료 단가표 분류(감사 D7)", () => {
  it("학원설정 과목(설정 순서) → 이미 쓰인 분류(ko 정렬 — 한글 먼저) → 기타·할인", () => {
    expect(tuitionCategoryOptions(["수학", "영어", "과학"], ["EIE", "국어", "수학", "할인"])).toEqual([
      "수학", "영어", "과학", "국어", "EIE", "기타", "할인",
    ]);
  });
  it("새 지점(쓰인 분류 없음)엔 쓰지 않는 과목이 안 뜬다", () => {
    expect(tuitionCategoryOptions(["수학", "과학"], [])).toEqual(["수학", "과학", "기타", "할인"]);
  });
  it("빈 값·공백·중복은 한 칸으로 접고 기타·할인은 늘 맨 뒤 한 번씩", () => {
    expect(tuitionCategoryOptions([" 수학 ", "기타", ""], ["수학", " ", "할인", "기타"])).toEqual(["수학", "기타", "할인"]);
  });
});
