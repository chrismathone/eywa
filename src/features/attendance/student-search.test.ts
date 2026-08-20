import { describe, expect, it } from "vitest";
import {
  emptySearchMessage,
  isSearchActive,
  matchesStudentSearch,
  normalizeSearchText,
} from "./student-search";

describe("검색어 정규화", () => {
  it("공백을 지우고 소문자로 맞춘다", () => {
    expect(normalizeSearchText(" 김 하늘 ")).toBe("김하늘");
    expect(normalizeSearchText("Kristine")).toBe("kristine");
  });

  it("공백만 친 것은 검색이 아니다 — 걸리면 화면이 통째로 비어 버린다", () => {
    expect(isSearchActive("")).toBe(false);
    expect(isSearchActive("   ")).toBe(false);
    expect(isSearchActive("김")).toBe(true);
  });
});

describe("학생 한 줄 매칭", () => {
  const row = ["김하늘A", "경명여중", "2", "경명여중2"] as const;

  it("이름 부분 일치", () => {
    expect(matchesStudentSearch("하늘", row)).toBe(true);
    expect(matchesStudentSearch("김하", row)).toBe(true);
    expect(matchesStudentSearch("박하늘", row)).toBe(false);
  });

  it("띄어쓰기·대소문자를 무시한다", () => {
    expect(matchesStudentSearch(" 김 하늘 ", row)).toBe(true);
    expect(matchesStudentSearch("kris", ["Kristine", null, null])).toBe(true);
    expect(matchesStudentSearch("KRIS", ["Kristine", null, null])).toBe(true);
  });

  it("같은 줄에 있는 학교·학년도 함께 본다", () => {
    expect(matchesStudentSearch("경명여중", row)).toBe(true);
    // 학교·학년은 화면에서 붙어 그려진다("경명여중2") — 친 그대로 걸려야 한다.
    expect(matchesStudentSearch("경명여중2", row)).toBe(true);
  });

  it("없는 값(null·빈 문자열)은 건너뛴다 — 있는 것만 본다", () => {
    expect(matchesStudentSearch("김", ["김하늘", null, undefined, ""])).toBe(true);
    expect(matchesStudentSearch("중", ["김하늘", null, undefined, ""])).toBe(false);
  });

  it("🔴 검색어가 비면 항상 참 — 필터가 없을 때 아무 줄도 안 그리는 사고를 구조로 막는다", () => {
    expect(matchesStudentSearch("", row)).toBe(true);
    expect(matchesStudentSearch("   ", row)).toBe(true);
    expect(matchesStudentSearch("", [null, null])).toBe(true);
  });

  it("초성 검색은 이번 범위가 아니다 — 안 걸리는 게 정상(고칠 땐 이 파일 한 곳)", () => {
    expect(matchesStudentSearch("ㄱㅎㄴ", row)).toBe(false);
  });
});

describe("결과 0명 안내", () => {
  it("무엇으로 걸렀는지·어디에 없는지를 한글로 밝힌다", () => {
    const msg = emptySearchMessage(" 홍길동 ", "이 달 출석부");
    expect(msg).toContain("홍길동");
    expect(msg).toContain("이 달 출석부");
    // raw 코드·영문 enum이 새지 않는다.
    expect(msg).not.toMatch(/[a-z_]{4,}/);
  });
});
