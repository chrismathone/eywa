import { describe, expect, it } from "vitest";
import {
  NO_SUBJECT,
  joinMulti,
  mixMatches,
  orderMulti,
  parseLevels,
  parseMixes,
  parseMulti,
} from "./list-filter-values";
import { parseStudentListPrefs, studentListPrefsFromUrl, DEFAULT_STUDENT_LIST_PREFS } from "./list/list-prefs";
import { coerceSubjectFilter } from "./scope-axis";

describe("다중 선택 값(원장 2026-09-28)", () => {
  it("옛 단일 값은 원소 하나 · 쉼표 여러 값 · all/빈 값/중복은 버린다", () => {
    expect(parseMulti("math")).toEqual(["math"]);
    expect(parseMulti("math,english")).toEqual(["math", "english"]);
    expect(parseMulti("all")).toEqual([]);
    expect(parseMulti(" math , ,math,all")).toEqual(["math"]);
    expect(parseMulti(undefined)).toEqual([]);
    expect(parseMulti(["math", 3, "english"])).toEqual(["math", "english"]);
    expect(joinMulti([])).toBe("all");
    expect(joinMulti(["math", NO_SUBJECT])).toBe(`math,${NO_SUBJECT}`);
  });

  it("선택지 순서로 정규화 — 같은 집합이 두 URL로 갈리지 않는다", () => {
    expect(orderMulti(["english", "math"], ["math", "english", "science"])).toEqual(["math", "english"]);
    expect(orderMulti(["x", "math"], ["math"])).toEqual(["math", "x"]);
  });

  it("계정 저장값 — 옛 단일 값·배열·쉼표 문자열이 모두 같은 쉼표 문자열로 접힌다", () => {
    expect(parseStudentListPrefs({ subject: "math" }).subject).toBe("math");
    expect(parseStudentListPrefs({ subject: ["math", "english"] }).subject).toBe("math,english");
    expect(parseStudentListPrefs({ grade: "중1,중2", teacher: "" }).grade).toBe("중1,중2");
    expect(parseStudentListPrefs({ teacher: "" }).teacher).toBe("all");
    expect(studentListPrefsFromUrl({ subject: `math,${NO_SUBJECT}` }, DEFAULT_STUDENT_LIST_PREFS).subject).toBe(
      `math,${NO_SUBJECT}`,
    );
  });

  it("강사 축 — 값마다 거르고 '미수강'은 남는다 · 필터를 감춘 화면(축 1개)은 전체", () => {
    const axis = new Set(["math", "english"]);
    expect(coerceSubjectFilter(axis, "math,science")).toBe("math");
    expect(coerceSubjectFilter(axis, `science,${NO_SUBJECT}`)).toBe(NO_SUBJECT);
    expect(coerceSubjectFilter(axis, "science")).toBe("all");
    expect(coerceSubjectFilter(new Set(["math"]), NO_SUBJECT)).toBe("all");
    expect(coerceSubjectFilter(null, "math,english")).toBe("math,english");
  });

  it("학교급·수강 구성 — 모르는 값은 버린다 · other는 활성 수강이 있는 neither만", () => {
    expect(parseLevels("elem,zzz,high")).toEqual(["elem", "high"]);
    expect(parseMixes("both,neither")).toEqual(["both"]);
    expect(mixMatches("neither", true, ["other"])).toBe(true);
    expect(mixMatches("neither", false, ["other"])).toBe(false);
    expect(mixMatches("both", true, ["englishOnly", "mathOnly"])).toBe(false);
    expect(mixMatches("both", true, [])).toBe(true);
  });
});
