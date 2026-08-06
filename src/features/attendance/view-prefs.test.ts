import { describe, expect, it } from "vitest";
import { parseAttendanceViewPrefs } from "./view-prefs";

describe("출석부 보기 설정 파서", () => {
  it("없거나 깨진 값은 기본값(전부 펼침)", () => {
    expect(parseAttendanceViewPrefs(undefined).collapsed).toEqual([]);
    expect(parseAttendanceViewPrefs(null).collapsed).toEqual([]);
    expect(parseAttendanceViewPrefs("접힘").collapsed).toEqual([]);
    expect(parseAttendanceViewPrefs({ collapsed: "a" }).collapsed).toEqual([]);
  });

  it("문자열 id만 남기고 중복은 없앤다", () => {
    expect(parseAttendanceViewPrefs({ collapsed: ["a", "a", 3, null, "b", ""] }).collapsed).toEqual(["a", "b"]);
  });

  it("형제 키가 섞여 와도 collapsed만 본다", () => {
    expect(parseAttendanceViewPrefs({ collapsed: ["a"], 딴것: 1 }).collapsed).toEqual(["a"]);
  });

  it("상한을 넘겨도 화면이 안 깨진다(잘라서 받는다)", () => {
    const many = Array.from({ length: 500 }, (_, i) => `c${i}`);
    expect(parseAttendanceViewPrefs({ collapsed: many }).collapsed).toHaveLength(300);
  });
});
