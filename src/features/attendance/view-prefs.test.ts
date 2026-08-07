import { describe, expect, it } from "vitest";
import { DEFAULT_ATTENDANCE_PREFS, parseAttendanceViewPrefs } from "./view-prefs";

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

describe("periodMode — 날짜축 보기 설정", () => {
  it("기본은 세션(정의가 없으면 서버가 달력월로 떨어뜨린다)", () => {
    expect(parseAttendanceViewPrefs({}).periodMode).toBe("session");
    expect(DEFAULT_ATTENDANCE_PREFS.periodMode).toBe("session");
  });

  it("month만 명시적으로 받는다 — 모르는 값은 세션으로", () => {
    expect(parseAttendanceViewPrefs({ periodMode: "month" }).periodMode).toBe("month");
    expect(parseAttendanceViewPrefs({ periodMode: "쓰레기" }).periodMode).toBe("session");
    expect(parseAttendanceViewPrefs({ periodMode: 7 }).periodMode).toBe("session");
  });

  // ⚠️ 필드가 하나 깨졌다고 통째로 기본값을 돌려주면 다른 설정이 조용히 사라진다.
  it("periodMode가 깨져도 정렬·접힘은 살아남는다", () => {
    const p = parseAttendanceViewPrefs({ periodMode: null, sort: "name", collapsed: ["c1"] });
    expect(p.periodMode).toBe("session");
    expect(p.sort).toBe("name");
    expect(p.collapsed).toEqual(["c1"]);
  });
});
