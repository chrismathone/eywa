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
  it.each([
    { className: "브릿지 A", englishTrack: "injaewon" },
    { className: "영어 A", englishTrack: "eie" },
  ])("$className 60분 두 교시(JJ 포함)는 하루 3시수", ({ className, englishTrack }) => {
    const e = enr({ subject: "english", className, englishTrack, schedules: [
      slot({ endTime: "17:00" }),
      slot({ startTime: "17:00", endTime: "18:00", slotTeacherLabel: "JJ" }),
    ] });
    expect(planTermsForMonth("2026-07", [e], [])[0].plannedSessions).toBe(12);
  });
  it("다른 요일에 40분 수업이 있으면 개인 수강 요일의 60분도 1.5로 환산한다", () => {
    const e = enr({ subject: "english", englishTrack: "injaewon", attendanceDays: [1], schedules: [
      slot({ endTime: "17:00" }), slot({ dayOfWeek: "tue", endTime: "16:40" }),
    ] });
    expect(planTermsForMonth("2026-07", [e], [])[0].plannedSessions).toBe(6);
    const ended = { ...e, schedules: [e.schedules![0], { ...e.schedules![1], validTo: "2026-06-30" }] };
    expect(planTermsForMonth("2026-07", [ended], [])[0].plannedSessions).toBe(4);
  });
  it("인재원 50분·60분·120분을 각각 1·1·2로 환산한다", () => {
    const e = enr({ subject: "english", englishTrack: "injaewon", schedules: [
      slot({ endTime: "16:50" }), slot({ startTime: "17:00", endTime: "18:00" }),
      slot({ startTime: "18:00", endTime: "20:00" }),
    ] });
    expect(planTermsForMonth("2026-07", [e], [])[0].plannedSessions).toBe(16);
  });
  it("설정이 비어 있어도 추석·대체공휴일과 추가 학원 휴무일을 제외한다", () => {
    const e = enr({ subject: "english", schedules: [slot({ dayOfWeek: "thu" }), slot({ dayOfWeek: "fri" }), slot({ dayOfWeek: "sat" })] });
    expect(planTermsForMonth("2026-09", [e], [])[0].plannedSessions).toBe(27);
    expect(planTermsForMonth("2026-09", [e], ["2026-09-03"])[0].plannedSessions).toBe(24);
    expect(planTermsForMonth("2026-08", [enr({ subject: "english", schedules: [slot()] })], [])[0].plannedSessions).toBe(12);
  });
  it("종강일 정정은 0시수이며 반 이동 당일은 이전 반에서 제외한다", () => {
    const e = enr({ subject: "english", endDate: "2026-09-01", schedules: [slot({ dayOfWeek: "tue" })] });
    expect(planTermsForMonth("2026-09", [e], [])[0].plannedSessions).toBe(3);
    expect(planTermsForMonth("2026-09", [{ ...e, isTransferred: true }], [])).toEqual([]);
    expect(planTermsForMonth("2026-09", [{ ...e, endDate: "2026-08-31" }], [])).toEqual([]);
  });
  it("3시간 수업은 하루 1.5, 휴일 제외 3일이면 4.5", () => {
    expect(planTermsForMonth("2026-07", [enr({ schedules: [slot()] })], ["2026-07-06"])[0].plannedSessions).toBe(4.5);
  });
  it("55분은 0.5이고 중복 등록 기간을 두 번 세지 않는다", () => {
    const e = enr({ schedules: [slot({ endTime: "16:55" })] });
    expect(planTermsForMonth("2026-07", [e, e], [])[0].plannedSessions).toBe(2);
  });
  it("시간표 유효기간의 변경을 반영하고 수납 계획에는 LAB도 포함", () => {
    const schedules = [slot({ validTo: "2026-07-10" }), slot({ validFrom: "2026-07-11", endTime: "18:00" }), slot({ startTime: "19:00", endTime: "21:00", slotTeacherLabel: "LAB" })];
    expect(planTermsForMonth("2026-07", [enr({ schedules })], [])[0].plannedSessions).toBe(8.5);
  });
  it("영어 JJ·LAB를 모두 포함하되 개인 요일·휴일·종료일과 중복 교시를 반영한다", () => {
    const first = slot({ startTime: "16:00", endTime: "16:55" });
    const jj = slot({ startTime: "17:00", endTime: "17:55", slotTeacherLabel: "JJ" });
    const lab = slot({ startTime: "18:00", endTime: "18:55", slotTeacherLabel: "LAB" });
    const thu = { ...lab, dayOfWeek: "thu" as const };
    const e = enr({ subject: "english", attendanceDays: [1], endDate: "2026-07-20", schedules: [first, jj, jj, lab, thu] });
    expect(planTermsForMonth("2026-07", [e], ["2026-07-06"])[0].plannedSessions).toBe(6);
    expect(planTermsForMonth("2026-07", [enr({ subject: "english", schedules: [jj, lab] })], [])[0].plannedSessions).toBe(8);
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
