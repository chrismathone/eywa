import { describe, it, expect } from "vitest";
import { sanitizeWorkSchedule, WORK_TIME_RANGE } from "./work-schedule";

describe("WORK_TIME_RANGE", () => {
  it("유효한 HH:MM-HH:MM 범위를 통과시킨다", () => {
    expect(WORK_TIME_RANGE.test("09:00-18:00")).toBe(true);
    expect(WORK_TIME_RANGE.test("00:00-23:59")).toBe(true);
    expect(WORK_TIME_RANGE.test("23:30-23:59")).toBe(true);
  });

  it("범위를 벗어난 시·분을 거부한다", () => {
    expect(WORK_TIME_RANGE.test("25:99-26:99")).toBe(false); // 리뷰에서 잡힌 케이스
    expect(WORK_TIME_RANGE.test("24:00-25:00")).toBe(false);
    expect(WORK_TIME_RANGE.test("09:60-10:00")).toBe(false);
  });

  it("형식이 어긋난 문자열을 거부한다", () => {
    expect(WORK_TIME_RANGE.test("9-17")).toBe(false);
    expect(WORK_TIME_RANGE.test("foo-bar")).toBe(false);
    expect(WORK_TIME_RANGE.test("09:00-18:00x")).toBe(false);
    expect(WORK_TIME_RANGE.test("0900-1800")).toBe(false);
    expect(WORK_TIME_RANGE.test("09:00")).toBe(false);
  });
});

describe("sanitizeWorkSchedule", () => {
  it("유효한 요일·시간대만 통과시킨다", () => {
    expect(
      sanitizeWorkSchedule({ mon: ["09:00-12:00", "14:00-18:00"], wed: ["10:00-13:00"] }),
    ).toEqual({ mon: ["09:00-12:00", "14:00-18:00"], wed: ["10:00-13:00"] });
  });

  it("유효하지 않은 시간대를 걸러내고, 모두 무효면 해당 요일 키를 생략한다", () => {
    expect(
      sanitizeWorkSchedule({ mon: ["09:00-18:00", "25:99-26:99"], tue: ["foo-bar"] }),
    ).toEqual({ mon: ["09:00-18:00"] });
  });

  it("알 수 없는 키와 비배열 값을 무시한다", () => {
    expect(
      sanitizeWorkSchedule({ funday: ["09:00-18:00"], mon: "09:00-18:00", tue: 123 }),
    ).toEqual({});
  });

  it("객체가 아니거나 null/undefined면 빈 객체를 반환한다", () => {
    expect(sanitizeWorkSchedule(null)).toEqual({});
    expect(sanitizeWorkSchedule(undefined)).toEqual({});
    expect(sanitizeWorkSchedule("nope")).toEqual({});
    expect(sanitizeWorkSchedule(42)).toEqual({});
  });

  it("빈 배열 요일은 키를 만들지 않는다", () => {
    expect(sanitizeWorkSchedule({ mon: [], tue: ["08:00-09:00"] })).toEqual({
      tue: ["08:00-09:00"],
    });
  });
});
