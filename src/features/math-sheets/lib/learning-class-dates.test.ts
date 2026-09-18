import { describe, expect, it } from "vitest";
import { learningClassDates } from "./learning-class-dates";
import type { LearningContext } from "./learning-plan";
const slot = (dayOfWeek: string, validFrom: string | null = null, validTo: string | null = null) => ({ dayOfWeek, validFrom, validTo, startTime: "16:00", endTime: "17:00" });
const context: LearningContext = { schedules: [slot("mon"), slot("thu"), { ...slot("thu"), startTime: "17:00" }], holidays: { "2026-09-24": "학원 휴원" }, spans: { s: [{ start: "2026-09-01", end: null }] } };
describe("반·학생별 수업 날짜", () => {
  it("월·목 반은 다른 평일을 추가하지 않고 연속 두 교시도 하루로 센다", () => {
    expect(learningClassDates("s", context, "2026-09-01", "2026-09-30")).toEqual(["2026-09-03", "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17", "2026-09-21", "2026-09-28"]);
  });
  it("월 중 시간표 변경, 학생 개별 등원요일과 수강 종료를 날짜별로 적용한다", () => {
    const changed = { ...context, schedules: [slot("mon", null, "2026-09-13"), slot("wed", "2026-09-14"), slot("thu")],
      spans: { s: [{ start: "2026-09-01", end: "2026-09-20", attendanceDays: ["mon", "wed"] }] } };
    expect(learningClassDates("s", changed, "2026-09-01", "2026-09-30")).toEqual(["2026-09-07", "2026-09-16"]);
    expect(learningClassDates("s", { ...changed, holidays: { "2026-09-16": "휴원" } }, "2026-09-01", "2026-09-30")).toEqual(["2026-09-07"]);
  });
  it("주말 반도 반영하고 일정·수강 이력이 없으면 평일을 만들어 넣지 않는다", () => {
    expect(learningClassDates("s", { ...context, schedules: [slot("sat")] }, "2026-09-01", "2026-09-13")).toEqual(["2026-09-05", "2026-09-12"]);
    expect(learningClassDates("s", { ...context, schedules: [] }, "2026-09-01", "2026-09-30")).toEqual([]);
    expect(learningClassDates("other", context, "2026-09-01", "2026-09-30")).toEqual([]);
  });
});
