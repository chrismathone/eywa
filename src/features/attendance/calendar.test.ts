import { describe, expect, it } from "vitest";
import { buildHolidayMap, dowIndexOf, dowsFromKeys, formatDows, resolveAttendDows } from "./calendar";

describe("dowIndexOf", () => {
  it("요일 키를 getDay() 인덱스로 매핑", () => {
    expect(dowIndexOf("sun")).toBe(0);
    expect(dowIndexOf("mon")).toBe(1);
    expect(dowIndexOf("sat")).toBe(6);
  });
  it("대소문자·공백 허용, 모르는 값은 -1", () => {
    expect(dowIndexOf(" Mon ")).toBe(1);
    expect(dowIndexOf("xyz")).toBe(-1);
    expect(dowIndexOf(null)).toBe(-1);
  });
});

describe("dowsFromKeys", () => {
  it("중복 제거 + 요일 순 정렬", () => {
    expect(dowsFromKeys(["fri", "mon", "mon"])).toEqual([1, 5]);
  });
  it("모르는 값은 버리고, 빈 입력은 빈 배열", () => {
    expect(dowsFromKeys(["mon", "nope", null])).toEqual([1]);
    expect(dowsFromKeys(null)).toEqual([]);
    expect(dowsFromKeys([])).toEqual([]);
  });
});

describe("formatDows", () => {
  it("가운뎃점으로 이어 붙인다", () => {
    expect(formatDows([1, 4])).toBe("월·목");
    expect(formatDows([0, 6])).toBe("일·토");
  });
  it("빈 배열은 빈 문자열(폴백은 호출부 몫)", () => {
    expect(formatDows([])).toBe("");
  });
});

describe("resolveAttendDows", () => {
  it("분리등원이 비면 반의 수업요일 전체", () => {
    expect(resolveAttendDows(null, [1, 4])).toEqual([1, 4]);
    expect(resolveAttendDows([], [1, 4])).toEqual([1, 4]);
  });
  it("분리등원이 있으면 그 요일만", () => {
    expect(resolveAttendDows(["mon"], [1, 4])).toEqual([1]);
  });
  it("반이 운영하지 않는 요일은 반 스케줄로 제한", () => {
    expect(resolveAttendDows(["mon", "sat"], [1, 4])).toEqual([1]);
  });
  it("반 스케줄이 아예 없으면(임포트 누락) 분리등원을 그대로 살린다", () => {
    expect(resolveAttendDows(["sat"], [])).toEqual([6]);
  });
});

describe("buildHolidayMap", () => {
  it("날짜 → 이름 맵", () => {
    expect(buildHolidayMap([{ date: "2026-07-17", name: "제헌절" }])).toEqual({ "2026-07-17": "제헌절" });
  });
  it("이름이 비면 '휴일'로 폴백, 형식이 틀린 날짜는 무시", () => {
    expect(buildHolidayMap([{ date: "2026-07-17", name: "  " }, { date: "26-7-17", name: "x" }])).toEqual({
      "2026-07-17": "휴일",
    });
  });
  it("빈 입력은 빈 맵", () => {
    expect(buildHolidayMap(null)).toEqual({});
  });
});
