import { describe, expect, it } from "vitest";
import {
  enumDayToKo,
  isWeekendDay,
  koDayToEnum,
  normalizePeriodId,
  periodLabel,
  periodToTimes,
  slotPeriodRow,
  subjectPeriodRows,
  settingsToPeriodsConfig,
} from "./periods";

describe("PeriodsConfig 주입 (owner 설정 교시 반영)", () => {
  const cfg = settingsToPeriodsConfig({
    weekdayPeriods: [
      { startTime: "10:00", endTime: "10:50" },
      { startTime: "11:00", endTime: "11:50" },
    ],
    weekendPeriods: [{ startTime: "08:00", endTime: "09:00" }],
  });

  it("periodToTimes가 설정 교시 시각을 반영", () => {
    expect(periodToTimes("1", "math", undefined, cfg)).toEqual({ startTime: "10:00", endTime: "10:50" });
    expect(periodToTimes("1", "math", { weekend: true }, cfg)).toEqual({ startTime: "08:00", endTime: "09:00" });
  });

  it("slotPeriodRow가 설정 시각 → 그룹 행으로 매핑(2교시=1그룹)", () => {
    const r = slotPeriodRow("math", "10:00", "mon", cfg);
    expect(r.key).toBe("m-1");
    expect(r.time).toBe("10:00~11:50"); // 2개 교시가 1그룹으로 묶임
  });

  it("subjectPeriodRows 행 수가 설정 교시 수에서 파생(2교시→1그룹, 주말 1교시)", () => {
    expect(subjectPeriodRows("math", false, cfg)).toHaveLength(1);
    expect(subjectPeriodRows("math", true, cfg)).toHaveLength(1);
  });

  it("빈 설정 배열이면 기본 상수로 폴백(동등성)", () => {
    const empty = settingsToPeriodsConfig({ weekdayPeriods: [], weekendPeriods: [] });
    expect(periodToTimes("1", "math", undefined, empty)).toEqual(periodToTimes("1", "math"));
  });
});

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
  it("영어는 11교시(통합영어시간표 시트 col A 기준)", () => {
    expect(periodToTimes("1", "english")).toEqual({ startTime: "14:20", endTime: "15:00" });
    expect(periodToTimes("6", "english")).toEqual({ startTime: "17:20", endTime: "18:10" });
    expect(periodToTimes("11", "english")).toEqual({ startTime: "21:10", endTime: "22:00" });
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
  it("영어 평일 10·11교시는 평일표에만, 주말 8교시엔 없음", () => {
    expect(periodToTimes("11", "english")).not.toBeNull();
    expect(periodToTimes("11", "english", { weekend: true })).toBeNull();
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

describe("시각→그리드 행(slotPeriodRow)", () => {
  it("수학 평일: 8교시를 4그룹으로 — 1·2교시 시작은 같은 1교시 그룹", () => {
    const a = slotPeriodRow("math", "14:30", "mon"); // 교시1
    const b = slotPeriodRow("math", "15:25", "mon"); // 교시2
    expect(a.key).toBe("m-1");
    expect(b.key).toBe("m-1"); // 같은 그룹 셀
    expect(a.label).toBe("1교시");
    expect(a.time).toBe("14:30~16:20");
  });
  it("수학 평일: 3교시 시작(16:20)은 2그룹, 8교시(21:05)는 4그룹", () => {
    expect(slotPeriodRow("math", "16:20", "tue").key).toBe("m-2");
    expect(slotPeriodRow("math", "21:05:00", "tue").key).toBe("m-4"); // HH:MM:SS도 처리
    expect(slotPeriodRow("math", "18:20", "tue").key).toBe("m-3"); // 5교시→3그룹(18:10→18:20 gap)
  });
  it("고등수학은 수학 그룹 체계 공용", () => {
    expect(slotPeriodRow("highmath", "14:30", "mon").key).toBe("m-1");
  });
  it("영어 평일: 11교시 개별 행(통합 시트 시각)", () => {
    expect(slotPeriodRow("english", "14:20", "mon")).toMatchObject({ key: "e-1", label: "1교시" });
    expect(slotPeriodRow("english", "16:20", "mon")).toMatchObject({ key: "e-4", time: "16:20~17:00" });
    expect(slotPeriodRow("english", "17:20", "mon")).toMatchObject({ key: "e-6", time: "17:20~18:10" });
    expect(slotPeriodRow("english", "21:10", "mon").key).toBe("e-11");
  });
  it("같은 16:20이라도 과목 따라 다른 행(수학 2그룹 vs 영어 4교시)", () => {
    expect(slotPeriodRow("math", "16:20", "mon").key).toBe("m-2");
    expect(slotPeriodRow("english", "16:20", "mon").key).toBe("e-4");
  });
  it("주말은 과목 무관 시간단위 8교시", () => {
    expect(slotPeriodRow("math", "09:00", "sat")).toMatchObject({ key: "w-1", time: "09:00~10:00" });
    expect(slotPeriodRow("english", "09:00", "sun").key).toBe("w-1"); // 주말은 영어도 동일
    expect(slotPeriodRow("math", "16:00", "sat").key).toBe("w-8");
  });
  it("매칭 안 되는 시각은 '기타' 행으로 폴백(throw 없음) — 시각 그대로 라벨", () => {
    const r = slotPeriodRow("math", "13:13", "mon");
    expect(r.key).toBe("x-13:13");
    expect(r.label).toBe("13:13");
    expect(r.order).toBe(13 * 60 + 13); // 시각(분) 기준
  });
  it("order는 시각(분) 기준 — 행이 시각순 정렬됨", () => {
    expect(slotPeriodRow("math", "08:00", "mon").order).toBeLessThan(
      slotPeriodRow("math", "13:13", "mon").order,
    );
    // 수학 1교시(14:30=870) < 2교시그룹(16:20=980)
    expect(slotPeriodRow("math", "14:30", "mon").order).toBe(14 * 60 + 30);
    expect(slotPeriodRow("math", "16:20", "mon").order).toBeGreaterThan(
      slotPeriodRow("math", "14:30", "mon").order,
    );
  });
});
