import { describe, expect, it } from "vitest";
import { monthRange, planTermsForMonth, type PlanEnrollment } from "./plan";
import type { AutoUnitsSchedule } from "@/features/attendance/auto-units";

const slot = (over: Partial<AutoUnitsSchedule> = {}): AutoUnitsSchedule => ({ dayOfWeek: "mon", startTime: "16:00", endTime: "19:00", validFrom: "2026-01-01", validTo: null, slotTeacherLabel: null, ...over });

const enr = (over: Partial<PlanEnrollment>): PlanEnrollment => ({
  classId: "c1",
  subject: "math",
  startDate: "2026-01-01",
  endDate: null,
  weekdays: [1, 4], // 월·목
  ...over,
});

describe("monthRange", () => {
  it("말일 계산(2월·31일 달)", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2026-07")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  });
  it("잘못된 입력은 null", () => {
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("불량")).toBeNull();
  });
});

describe("출석부 기준 계획 시수", () => {
  it("3시간 수업은 하루 1.5, 휴일 제외 3일이면 4.5", () => {
    expect(planTermsForMonth("2026-07", [enr({ schedules: [slot()] })], ["2026-07-06"])[0].plannedSessions).toBe(4.5);
  });
  it("55분은 0.5이고 중복 등록 기간을 두 번 세지 않는다", () => {
    const e = enr({ schedules: [slot({ endTime: "16:55" })] });
    expect(planTermsForMonth("2026-07", [e, e], [])[0].plannedSessions).toBe(2);
  });
  it("시간표 유효기간의 변경과 LAB 제외를 출석부와 동일하게 적용", () => {
    const schedules = [slot({ validTo: "2026-07-10" }), slot({ validFrom: "2026-07-11", endTime: "18:00" }), slot({ startTime: "19:00", endTime: "21:00", slotTeacherLabel: "LAB" })];
    expect(planTermsForMonth("2026-07", [enr({ schedules })], [])[0].plannedSessions).toBe(4.5);
  });
  it("일반 영어는 하루의 여러 교시를 합산하며 같은 시작시간은 중복 제외", () => {
    const first = slot({ endTime: "16:55" });
    const second = slot({ startTime: "17:00", endTime: "17:55" });
    expect(planTermsForMonth("2026-07", [enr({ subject: "english", schedules: [first, first, second] })], [])[0].plannedSessions).toBe(8);
  });
});

describe("planTermsForMonth", () => {
  it("월·목 반 = 2026-07(월4·목5) 9회, 공휴일 없음", () => {
    const t = planTermsForMonth("2026-07", [enr({})], []);
    expect(t).toEqual([{ subject: "math", classId: "c1", plannedSessions: 9 }]);
  });

  it("공휴일 제외 — 8/15(토)와 무관, 월요일 공휴일이면 1회 감소", () => {
    const base = planTermsForMonth("2026-07", [enr({})], [])[0]!.plannedSessions;
    const t = planTermsForMonth("2026-07", [enr({})], ["2026-07-06"]); // 월요일
    expect(t[0]!.plannedSessions).toBe(base - 1);
  });

  it("월중 등록 — 시작일 이후만 카운트(계획 N이 자연 감소)", () => {
    const full = planTermsForMonth("2026-07", [enr({})], [])[0]!.plannedSessions;
    const mid = planTermsForMonth("2026-07", [enr({ startDate: "2026-07-15" })], [])[0]!.plannedSessions;
    expect(mid).toBeLessThan(full);
    expect(mid).toBeGreaterThan(0);
  });

  it("월중 퇴원 — end_date 이후 제외, 이 달과 안 겹치면 행 자체가 없음", () => {
    const t = planTermsForMonth("2026-07", [enr({ endDate: "2026-06-30" })], []);
    expect(t).toEqual([]);
  });

  it("같은 과목 복수 반 = 절대 합산하지 않고 반마다 별도 행(단가 상이 — 2026-07-13 원장 지시)", () => {
    const t = planTermsForMonth(
      "2026-07",
      [enr({ classId: "c1", weekdays: [1] }), enr({ classId: "c2", weekdays: [4] })],
      [],
    );
    expect(t).toHaveLength(2);
    expect(t.map((x) => [x.classId, x.plannedSessions])).toEqual([["c1", 4], ["c2", 5]]); // 월4·목5
  });

  it("같은 반 중복 enrollment(연속 재등록)는 기간 합산", () => {
    const t = planTermsForMonth(
      "2026-07",
      [
        enr({ startDate: "2026-07-01", endDate: "2026-07-10", weekdays: [1] }),
        enr({ startDate: "2026-07-20", endDate: null, weekdays: [1] }),
      ],
      [],
    );
    expect(t).toHaveLength(1);
    expect(t[0]!.plannedSessions).toBe(3); // 월요일 7/6(전반) + 7/20·27(후반)
  });

  it("과목별 분리 정렬", () => {
    const t = planTermsForMonth(
      "2026-07",
      [enr({ subject: "math" }), enr({ classId: "c9", subject: "english", weekdays: [2] })],
      [],
    );
    expect(t.map((x) => x.subject)).toEqual(["english", "math"]);
  });

  it("요일 없는 반(스케줄 미입력)은 제외 — 0회 행을 만들지 않음", () => {
    expect(planTermsForMonth("2026-07", [enr({ weekdays: [] })], [])).toEqual([]);
  });
});
