import { describe, expect, it } from "vitest";
import { attendanceUnitsDiff } from "./unit-suffix";
import { teacherFourWeekWeights, teacherTermSessions, teacherTermWeights, type TermShareSchedule } from "./teacher-term-share";

const slot = (teacherId: string | null, startTime: string, endTime: string, extra: Partial<TermShareSchedule> = {}): TermShareSchedule => ({
  teacherId, startTime, endTime, dayOfWeek: "tue", validFrom: "2026-09-01", validTo: null, slotTeacherLabel: null, ...extra,
});
const enrolled = { startDate: "2026-09-01", endDate: null, isTransferred: false, attendanceDays: null };
const base = { month: "2026-09", enrollments: [enrolled], homeroomTeacherId: "home", englishTrack: "eie", className: "LS4", holidays: new Set<string>(), scopeTeacherId: "home" };
const term = { units: 15, daysBasis: false };

describe("EiE fixed four-week registration", () => {
  it("counts every weekday four times across a month boundary and excludes *LAB", () => {
    const schedules = (["tue", "thu", "fri"] as const).flatMap((dayOfWeek) => [
      slot("home", "15:00", "15:40", { dayOfWeek }),
      slot("other", "15:40", "16:20", { dayOfWeek }),
      slot(null, "16:20", "17:00", { dayOfWeek, slotTeacherLabel: "LAB" }),
      slot(null, "17:00", "17:40", { dayOfWeek, slotTeacherLabel: "LAB", labSeparate: true }),
    ]);
    const weights = teacherFourWeekWeights({ referenceDate: "2026-09-29", schedules, homeroomTeacherId: "home", className: "LS4b" });
    expect([...weights]).toEqual([["home", 12], ["other", 12], ["", 12]]);
    expect(teacherTermSessions({ units: 36, daysBasis: false }, "home", weights)).toEqual({ units: 12, daysBasis: false, classUnits: 36 });
  });

  it("uses the timetable effective on the reference date, excluding past and future owners", () => {
    const weights = teacherFourWeekWeights({ referenceDate: "2026-09-21", homeroomTeacherId: "home", className: "PL1a", schedules: [
      slot("past", "15:00", "15:40", { validTo: "2026-09-16" }),
      slot("current", "15:00", "15:40", { validFrom: "2026-09-17", validTo: "2026-09-22" }),
      slot("future", "15:00", "15:40", { validFrom: "2026-09-23" }),
    ] });
    expect([...weights]).toEqual([["current", 4]]);
  });
});

describe("confirmed English registration apportioned by the student's scheduled periods", () => {
  it("gives a teacher two thirds, not the whole class total; seats do not fall back to homeroom", () => {
    const weights = teacherTermWeights({ ...base, schedules: [slot(null, "14:00", "14:40"), slot("home", "14:40", "15:20"), slot(null, "15:20", "16:00", { slotTeacherLabel: "LAB" })] });
    expect(teacherTermSessions(term, "home", weights)).toEqual({ units: 10, daysBasis: false, classUnits: 15 });
    expect(teacherTermSessions(term, "other", weights).units).toBe(0);
    expect(teacherTermSessions(term, "", weights).units).toBe(5);
  });

  it("uses a student's own days and does not multiply overlapping enrollments", () => {
    const schedules = [slot("home", "14:00", "15:00"), slot("other", "14:00", "15:00", { dayOfWeek: "fri" })];
    const ownDays = { ...enrolled, attendanceDays: ["fri"] };
    const weights = teacherTermWeights({ ...base, schedules, enrollments: [ownDays, ownDays] });
    expect([...weights]).toEqual([["other", 6]]); // four Fridays × 1.5
    expect(teacherTermSessions({ ...term, units: 6 }, "home", weights).units).toBe(0);
    expect(teacherTermSessions({ ...term, units: 6 }, "other", weights).units).toBe(6);
  });

  it("respects mid-month enrollment, transfer end, schedule history and holidays", () => {
    const weights = teacherTermWeights({ ...base, holidays: new Set(["2026-09-22"]),
      enrollments: [{ ...enrolled, startDate: "2026-09-08", endDate: "2026-09-29", isTransferred: true }],
      schedules: [slot("home", "14:00", "14:40", { validTo: "2026-09-14" }), slot("other", "14:00", "14:40", { validFrom: "2026-09-15" })],
    });
    expect([...weights]).toEqual([["home", 1], ["other", 1]]);
    expect(teacherTermSessions({ ...term, units: 2 }, "home", weights).units).toBe(1);
    expect(teacherTermSessions({ ...term, units: 2 }, "other", weights).units).toBe(1);
  });

  it("weights EiE 60 minutes as 1.5 and 40 minutes as 1, including bridge timetables", () => {
    for (const englishTrack of ["eie", "injaewon"]) {
      const weights = teacherTermWeights({ ...base, englishTrack, className: "중등E_초등 브릿지 A", schedules: [slot("home", "14:00", "15:00"), slot("other", "15:00", "15:40")] });
      expect(teacherTermSessions({ ...term, units: 12.5 }, "home", weights).units).toBe(7.5);
      expect(teacherTermSessions({ ...term, units: 12.5 }, "other", weights).units).toBe(5);
    }
  });

  it("counts a 50-minute Injaewon period and a 60-minute period as one each", () => {
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", schedules: [slot("home", "14:00", "14:50"), slot("other", "15:00", "16:00")] });
    expect(teacherTermSessions({ ...term, units: 10 }, "home", weights).units).toBe(5);
  });

  it("excludes a separately displayed LAB alternative from the denominator", () => {
    const weights = teacherTermWeights({ ...base, schedules: [
      slot("home", "14:00", "14:40"), slot("home", "14:40", "15:20"),
      slot(null, "15:20", "16:00", { slotTeacherLabel: "LAB" }),
      slot(null, "16:00", "16:40", { slotTeacherLabel: "LAB", labSeparate: true }),
    ] });
    expect(teacherTermSessions(term, "home", weights).units).toBe(10);
    expect(teacherTermSessions(term, "", weights).units).toBe(5);
  });

  it("counts *LAB as zero whether marked by the stored toggle or its displayed label", () => {
    const weights = teacherTermWeights({ ...base, schedules: [
      slot("home", "14:00", "14:40"),
      slot(null, "14:40", "15:20", { slotTeacherLabel: "LAB" }),
      slot(null, "15:20", "16:00", { slotTeacherLabel: "*lab" }),
      slot(null, "16:00", "16:40", { slotTeacherLabel: "LAB", labSeparate: true }),
    ] });
    expect([...weights]).toEqual([["home", 5], ["", 5]]);
    expect(teacherTermSessions({ ...term, units: 10 }, "home", weights).units).toBe(5);
  });

  it("splits the early and late bridge groups: Kristine .5, Jane 2, Florence .5 per day", () => {
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", className: "중등E_초등 브릿지 A", schedules: [
      slot("kristine", "14:20", "15:00"), slot("jane", "15:00", "15:40"),
      slot("jane", "15:40", "16:20"), slot("florence", "16:20", "17:00"),
    ] });
    expect([...weights]).toEqual([["kristine", 2.5], ["jane", 10], ["florence", 2.5]]);
    expect([...weights.keys()].map((id) => teacherTermSessions(term, id, weights).units)).toEqual([2.5, 10, 2.5]);
  });

  it("uses the bridge basis consistently across different weekdays", () => {
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", className: "중등E_초등 브릿지 B", schedules: [
      slot("home", "14:00", "15:00"),
      slot("other", "14:00", "14:40", { dayOfWeek: "wed" }),
    ] });
    expect([...weights]).toEqual([["home", 7.5], ["other", 5]]);
    expect(teacherTermSessions({ ...term, units: 12.5 }, "home", weights).units).toBe(7.5);
  });

  it("deduplicates the same start time and leaves an ambiguous teacher unallocated", () => {
    const weights = teacherTermWeights({ ...base, schedules: [slot("home", "14:00", "14:40"), slot("other", "14:00:00", "14:40:00")] });
    expect([...weights]).toEqual([["", 5]]);
    expect(teacherTermSessions({ ...term, units: 5 }, "home", weights).units).toBe(0);
  });

  it("does not assign pre-homeroom time to the current homeroom teacher", () => {
    const weights = teacherTermWeights({ ...base, homeroomSince: "2026-09-15", schedules: [slot(null, "14:00", "14:40")] });
    expect([...weights]).toEqual([["", 2], ["home", 3]]);
  });

  it("does not assign arbitrary tenths when the confirmed total cannot divide into teaching units", () => {
    const weights = new Map([["teacher-c", 1], ["teacher-b", 1], ["teacher-a", 1]]);
    for (const id of weights.keys()) {
      const result = teacherTermSessions({ ...term, units: 1 }, id, weights);
      expect(result).toMatchObject({ classUnits: 1, allocationPending: true });
      expect(attendanceUnitsDiff(1, result)).toBeNull();
    }
  });

  it("hourly 중2 특별 stays Elsa 14 + Song 3 + JJ 7 with one shortened 40-minute period", () => {
    const schedules = [
      slot(null, "19:20", "20:10", { dayOfWeek: "mon", slotTeacherLabel: "JJ" }),
      slot("elsa", "20:20", "21:10", { dayOfWeek: "mon" }),
      slot("elsa", "19:20", "20:10", { dayOfWeek: "wed" }),
      slot("elsa", "20:20", "21:10", { dayOfWeek: "wed" }),
      slot(null, "19:20", "20:10", { dayOfWeek: "thu", slotTeacherLabel: "JJ" }),
      slot("song", "20:20", "21:00", { dayOfWeek: "thu" }),
    ];
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", className: "중고E_중2 특별", schedules, holidays: new Set(["2026-09-24", "2026-09-25", "2026-09-26"]) });
    const registered = { units: 300000 / 12500, daysBasis: false };
    const shares = ["elsa", "song", ""].map((id) => teacherTermSessions(registered, id, weights));
    expect(shares.map((s) => s.units)).toEqual([14, 3, 7]);
    expect(shares.every((s) => !s.allocationPending)).toBe(true);
    expect(shares.reduce((sum, s) => sum + s.units * 12500, 0)).toBe(300000);
    expect(attendanceUnitsDiff(14, shares[0])).toBe(0);
  });

  it("hourly 중2 정규 C is teacher 16 + JJ 8 despite shortened final periods", () => {
    const schedules = (["tue", "fri"] as const).flatMap((dayOfWeek) => [
      slot(null, "18:20", "19:20", { dayOfWeek, slotTeacherLabel: "JJ" }),
      slot("home", "19:20", "20:10", { dayOfWeek }),
      slot("home", "20:20", "21:00", { dayOfWeek }),
    ]);
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", className: "중등E_중2 정규 C",
      schedules, holidays: new Set(["2026-09-24", "2026-09-25", "2026-09-26"]),
    });
    expect([...weights]).toEqual([["", 8], ["home", 16]]);
    expect(teacherTermSessions({ units: 24, daysBasis: false }, "home", weights)).toEqual({ units: 16, daysBasis: false, classUnits: 24 });
  });

  it("keeps an exact teacher + JJ split unchanged by teacher-id sorting", () => {
    const weights = new Map([["teacher-z", 1.5], ["", 1], ["teacher-a", 1.5]]);
    const shares = [...weights.keys()].map((id) => teacherTermSessions({ ...term, units: 4 }, id, weights).units);
    expect(shares).toEqual([1.5, 1, 1.5]);
  });

  it("does not invent an owner for excess registration when no homeroom teacher is designated", () => {
    const weights = new Map([["teacher", 5], ["", 5]]);
    for (const id of weights.keys()) {
      expect(teacherTermSessions({ ...term, units: 45 }, id, weights)).toMatchObject({ allocationPending: true, classUnits: 45 });
    }
  });

  it("marks a missing schedule and homeroom as pending; zero stays zero and old day-basis stays flagged", () => {
    const weights = teacherTermWeights({ ...base, homeroomTeacherId: null, schedules: [] });
    const pending = teacherTermSessions(term, "home", weights);
    expect(pending).toMatchObject({ allocationPending: true, classUnits: 15 });
    expect(attendanceUnitsDiff(3, pending)).toBeNull();
    expect(teacherTermSessions({ ...term, units: 0 }, "home", weights)).toEqual({ units: 0, daysBasis: false, classUnits: 0 });
    expect(teacherTermSessions({ ...term, daysBasis: true }, "home", weights)).toEqual({ ...term, daysBasis: true });
    expect(teacherTermWeights({ ...base, enrollments: [], schedules: [slot("home", "14:00", "14:40")] }).size).toBe(0);
  });

  it("MED is a bridge by its 40-minute timetable, including 20-minute half units", () => {
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", className: "중등E_초5 MED",
      schedules: [slot("home", "15:00", "15:40"), slot("home", "15:40", "16:00"),
        slot(null, "16:20", "17:00", { slotTeacherLabel: "JJ" }),
        slot("other", "15:00", "16:00", { dayOfWeek: "wed" })],
    });
    expect([...weights]).toEqual([["home", 7.5], ["", 5], ["other", 7.5]]);
    expect(teacherTermSessions({ units: 21, daysBasis: false }, "home", weights)).toEqual({ units: 8.5, daysBasis: false, classUnits: 21 });
  });

  it("assigns the extra 1U to homeroom: confirmed 25 = Jane 16 + JJ 9", () => {
    const weights = Object.assign(new Map([["jane", 15], ["", 9]]), { homeroomTeacherId: "jane" });
    const registered = { units: 25, daysBasis: false };
    expect(teacherTermSessions(registered, "jane", weights)).toEqual({ units: 16, daysBasis: false, classUnits: 25 });
    expect(teacherTermSessions(registered, "", weights).units).toBe(9);
    expect(teacherTermSessions(registered, "viewer", weights).units).toBe(0);
  });

  it("gives the remainder to homeroom even when another teacher owns every scheduled period", () => {
    const weights = Object.assign(new Map([["other", 6]]), { homeroomTeacherId: "home" });
    expect(teacherTermSessions(term, "home", weights).units).toBe(9);
    expect(teacherTermSessions(term, "other", weights).units).toBe(6);
  });

  it("assigns fully unallocated registration to the designated homeroom teacher", () => {
    const weights = teacherTermWeights({ ...base, schedules: [] });
    expect(teacherTermSessions(term, "home", weights)).toEqual({ units: 15, daysBasis: false, classUnits: 15 });
    expect(teacherTermSessions(term, "other", weights).units).toBe(0);
  });
});
