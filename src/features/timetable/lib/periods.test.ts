import { describe, expect, it } from "vitest";
import {
  enumDayToKo,
  isWeekendDay,
  koDayToEnum,
  normalizePeriodId,
  periodLabel,
  periodToTimes,
} from "./periods";

describe("요일 변환", () => {
  it("한글→enum 7요일 매핑", () => {
    expect(koDayToEnum("월")).toBe("mon");
    expect(koDayToEnum("일")).toBe("sun");
    expect(koDayToEnum("토")).toBe("sat");
    expect(koDayToEnum(" 수 ")).toBe("wed"); // trim
  });
  it("알 수 없는 요일은 null", () => {
    expect(koDayToEnum("x")).toBeNull();
    expect(koDayToEnum("")).toBeNull();
  });
  it("enum→한글 왕복", () => {
    expect(enumDayToKo("mon")).toBe("월");
    expect(enumDayToKo("sun")).toBe("일");
    for (const ko of ["월", "화", "수", "목", "금", "토", "일"]) {
      expect(enumDayToKo(koDayToEnum(ko)!)).toBe(ko);
    }
  });
  it("주말 판정", () => {
    expect(isWeekendDay("sat")).toBe(true);
    expect(isWeekendDay("sun")).toBe(true);
    expect(isWeekendDay("fri")).toBe(false);
    expect(isWeekendDay("mon")).toBe(false);
  });
});

describe("교시 정규화", () => {
  it("레거시 키를 통일 periodId로", () => {
    expect(normalizePeriodId("1-1")).toBe("1");
    expect(normalizePeriodId("4-2")).toBe("8");
    expect(normalizePeriodId("3-1")).toBe("5");
  });
  it("이미 통일이면 그대로 + trim", () => {
    expect(normalizePeriodId("7")).toBe("7");
    expect(normalizePeriodId(" 10 ")).toBe("10");
  });
});

describe("교시→시각", () => {
  it("수학 평일 8교시 경계", () => {
    expect(periodToTimes("1", "math")).toEqual({ startTime: "14:30", endTime: "15:25" });
    expect(periodToTimes("8", "math")).toEqual({ startTime: "21:05", endTime: "22:00" });
  });
  it("highmath는 수학 교시표 공용", () => {
    expect(periodToTimes("5", "highmath")).toEqual(periodToTimes("5", "math"));
  });
  it("영어는 10교시(1~6 40분, 7~10 55분)", () => {
    expect(periodToTimes("1", "english")).toEqual({ startTime: "14:20", endTime: "15:00" });
    expect(periodToTimes("6", "english")).toEqual({ startTime: "17:40", endTime: "18:20" });
    expect(periodToTimes("10", "english")).toEqual({ startTime: "21:05", endTime: "22:00" });
  });
  it("레거시 키도 변환 후 매핑", () => {
    expect(periodToTimes("1-1", "math")).toEqual({ startTime: "14:30", endTime: "15:25" });
    expect(periodToTimes("4-2", "math")).toEqual({ startTime: "21:05", endTime: "22:00" });
  });
  it("주말은 과목 무관 09:00 기준 1시간 단위", () => {
    expect(periodToTimes("1", "math", { weekend: true })).toEqual({
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(periodToTimes("1", "english", { weekend: true })).toEqual({
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(periodToTimes("8", "math", { weekend: true })).toEqual({
      startTime: "16:00",
      endTime: "17:00",
    });
  });
  it("영어 평일 9·10교시는 평일표에만, 주말 8교시엔 없음", () => {
    expect(periodToTimes("10", "english")).not.toBeNull();
    expect(periodToTimes("10", "english", { weekend: true })).toBeNull();
  });
  it("알 수 없는 교시는 null", () => {
    expect(periodToTimes("99", "math")).toBeNull();
    expect(periodToTimes("9", "math")).toBeNull(); // 수학은 8교시까지
  });
});

describe("교시 라벨", () => {
  it("표시용 라벨", () => {
    expect(periodLabel("3")).toBe("3교시");
    expect(periodLabel("1-2")).toBe("2교시"); // 정규화 후
  });
});
