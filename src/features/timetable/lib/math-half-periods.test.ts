import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG, subjectWeekdayPeriods, subjectWeekendPeriods } from "./periods";

describe("수학 평일 반교시 이름", () => {
  it("저장 키와 시각을 유지하면서 1-1부터 4-2까지 표시한다", () => {
    const original = DEFAULT_PERIODS_CONFIG.weekday;
    const rows = subjectWeekdayPeriods("math");
    expect(rows.map(r => r.label)).toEqual(["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"]);
    expect(rows.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime }))).toEqual(Object.entries(original).map(([id, time]) => ({ id, ...time })));
  });
  it("설정의 기본 번호도 반교시로 표시하되 사용자 이름과 빈 이름은 지킨다", () => {
    const config = { ...DEFAULT_PERIODS_CONFIG, weekday: {
      "1": { startTime: "14:20", endTime: "15:20", label: "1교시" },
      "2": { startTime: "15:25", endTime: "16:20", label: "2교시" },
      "3": { startTime: "16:20", endTime: "17:15", label: "특별 수업" },
      "4": { startTime: "17:15", endTime: "18:10", label: "" },
    } };
    expect(subjectWeekdayPeriods("math", config).map(r => r.label)).toEqual(["1-1", "1-2", "특별 수업", ""]);
    expect(subjectWeekdayPeriods("korean", config).map(r => r.label)).toEqual(["1교시", "2교시", "특별 수업", ""]);
    expect(subjectWeekendPeriods(config).every(r => r.label === undefined)).toBe(true);
  });
});
