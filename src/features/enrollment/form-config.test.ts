import { describe, expect, it } from "vitest";
import { ENGLISH_GROUPS, ENGLISH_TEST_TYPES, englishGroupsFor, englishTestTypesFor } from "./form-config";

describe("영어 상담 폼의 EiE 스위치", () => {
  it("EiE가 켜진 지점은 기존 테스트 유형과 칸을 그대로 쓴다", () => {
    expect(englishTestTypesFor(true)).toEqual(ENGLISH_TEST_TYPES);
    expect(englishGroupsFor("eie", true)).toEqual(ENGLISH_GROUPS.eie);
  });

  it("EiE가 꺼지면 이름과 전용 칸을 숨기고 일반 영어 칸으로 돌아간다", () => {
    expect(englishTestTypesFor(false).map((type) => type.value)).toEqual(["ai", "nelt"]);
    expect(englishGroupsFor("eie", false)).toEqual(ENGLISH_GROUPS.ai);
  });
});
