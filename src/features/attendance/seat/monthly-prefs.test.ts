import { describe, expect, it } from "vitest";
import { DEFAULT_SEAT_MONTHLY_PREFS, parseSeatMonthlyPrefs } from "./monthly-prefs";

describe("자리 월간 보기 설정", () => {
  it("없거나 깨진 값은 전부 펼침", () => {
    expect(parseSeatMonthlyPrefs(undefined)).toEqual(DEFAULT_SEAT_MONTHLY_PREFS);
    expect(parseSeatMonthlyPrefs(null).collapsed).toEqual([]);
    expect(parseSeatMonthlyPrefs({ collapsed: "a" }).collapsed).toEqual([]);
  });

  it("형제 키(attendance 등)는 무시하고 collapsed만 본다", () => {
    expect(parseSeatMonthlyPrefs({ collapsed: ["a", "a", 3], attendance: { sort: "name" } }).collapsed).toEqual(["a"]);
  });

  it("상한을 넘겨도 화면이 안 깨진다", () => {
    const many = Array.from({ length: 500 }, (_, i) => `c${i}`);
    expect(parseSeatMonthlyPrefs({ collapsed: many }).collapsed).toHaveLength(300);
  });
});
