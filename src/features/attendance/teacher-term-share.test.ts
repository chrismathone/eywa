import { describe, expect, it } from "vitest";
import { attendanceUnitsDiff } from "./unit-suffix";
import { teacherTermSessions, teacherTermWeights, type TermShareSchedule } from "./teacher-term-share";

const slot = (teacherId: string | null, startTime: string, endTime: string, extra: Partial<TermShareSchedule> = {}): TermShareSchedule => ({
  teacherId, startTime, endTime, dayOfWeek: "tue", validFrom: "2026-09-01", validTo: null, slotTeacherLabel: null, ...extra,
});
const enrolled = { startDate: "2026-09-01", endDate: null, isTransferred: false, attendanceDays: null };
const base = { month: "2026-09", enrollments: [enrolled], homeroomTeacherId: "home", englishTrack: "eie", holidays: new Set<string>(), scopeTeacherId: "home" };
const term = { units: 21, daysBasis: false };

describe("confirmed English registration apportioned by the student's scheduled periods", () => {
  it("gives a teacher two thirds, not the whole class total; seats do not fall back to homeroom", () => {
    const weights = teacherTermWeights({ ...base, schedules: [slot(null, "14:00", "14:40"), slot("home", "14:40", "15:20"), slot(null, "15:20", "16:00", { slotTeacherLabel: "LAB" })] });
    expect(teacherTermSessions(term, "home", weights)).toEqual({ units: 14, daysBasis: false, classUnits: 21 });
    expect(teacherTermSessions(term, "other", weights).units).toBe(0);
    expect(teacherTermSessions(term, "", weights).units).toBe(7);
  });

  it("uses a student's own days and does not multiply overlapping enrollments", () => {
    const schedules = [slot("home", "14:00", "15:00"), slot("other", "14:00", "15:00", { dayOfWeek: "fri" })];
    const ownDays = { ...enrolled, attendanceDays: ["fri"] };
    const weights = teacherTermWeights({ ...base, schedules, enrollments: [ownDays, ownDays] });
    expect([...weights]).toEqual([["other", 6]]); // four Fridays × 1.5
    expect(teacherTermSessions(term, "home", weights).units).toBe(0);
    expect(teacherTermSessions(term, "other", weights).units).toBe(21);
  });

  it("respects mid-month enrollment, transfer end, schedule history and holidays", () => {
    const weights = teacherTermWeights({ ...base, holidays: new Set(["2026-09-22"]),
      enrollments: [{ ...enrolled, startDate: "2026-09-08", endDate: "2026-09-29", isTransferred: true }],
      schedules: [slot("home", "14:00", "14:40", { validTo: "2026-09-14" }), slot("other", "14:00", "14:40", { validFrom: "2026-09-15" })],
    });
    expect([...weights]).toEqual([["home", 1], ["other", 1]]);
    expect(teacherTermSessions({ ...term, units: 3 }, "home", weights).units).toBe(1.5);
    expect(teacherTermSessions({ ...term, units: 3 }, "other", weights).units).toBe(1.5);
  });

  it("weights EiE 60 minutes as 1.5 and 40 minutes as 1, including bridge timetables", () => {
    for (const englishTrack of ["eie", "injaewon"]) {
      const weights = teacherTermWeights({ ...base, englishTrack, schedules: [slot("home", "14:00", "15:00"), slot("other", "15:00", "15:40")] });
      expect(teacherTermSessions({ ...term, units: 10 }, "home", weights).units).toBe(6);
      expect(teacherTermSessions({ ...term, units: 10 }, "other", weights).units).toBe(4);
    }
  });

  it("counts a 50-minute Injaewon period and a 60-minute period as one each", () => {
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", schedules: [slot("home", "14:00", "14:50"), slot("other", "15:00", "16:00")] });
    expect(teacherTermSessions({ ...term, units: 9 }, "home", weights).units).toBe(4.5);
  });

  it("excludes a separately displayed LAB alternative from the denominator", () => {
    const weights = teacherTermWeights({ ...base, schedules: [
      slot("home", "14:00", "14:40"), slot("home", "14:40", "15:20"),
      slot(null, "15:20", "16:00", { slotTeacherLabel: "LAB" }),
      slot(null, "16:00", "16:40", { slotTeacherLabel: "LAB", labSeparate: true }),
    ] });
    expect(teacherTermSessions(term, "home", weights).units).toBe(14);
    expect(teacherTermSessions(term, "", weights).units).toBe(7);
  });

  it("uses the bridge basis consistently across different weekdays", () => {
    const weights = teacherTermWeights({ ...base, englishTrack: "injaewon", schedules: [
      slot("home", "14:00", "15:00"),
      slot("other", "14:00", "14:40", { dayOfWeek: "wed" }),
    ] });
    expect([...weights]).toEqual([["home", 7.5], ["other", 5]]);
    expect(teacherTermSessions({ ...term, units: 10 }, "home", weights).units).toBe(6);
  });

  it("deduplicates the same start time and leaves an ambiguous teacher unallocated", () => {
    const weights = teacherTermWeights({ ...base, schedules: [slot("home", "14:00", "14:40"), slot("other", "14:00:00", "14:40:00")] });
    expect([...weights]).toEqual([["", 5]]);
    expect(teacherTermSessions(term, "home", weights).units).toBe(0);
  });

  it("does not assign pre-homeroom time to the current homeroom teacher", () => {
    const weights = teacherTermWeights({ ...base, homeroomSince: "2026-09-15", schedules: [slot(null, "14:00", "14:40")] });
    expect([...weights]).toEqual([["", 2], ["home", 3]]);
  });

  it("keeps the confirmed total despite rounding, with deterministic residual allocation", () => {
    const weights = new Map([["teacher-c", 1], ["teacher-b", 1], ["teacher-a", 1]]);
    const result = [...weights.keys()].map((id) => teacherTermSessions({ ...term, units: 1 }, id, weights).units);
    expect(result).toEqual([0.3, 0.3, 0.4]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("marks a missing schedule or enrollment as pending; zero stays zero and old day-basis stays flagged", () => {
    const weights = teacherTermWeights({ ...base, schedules: [] });
    const pending = teacherTermSessions(term, "home", weights);
    expect(pending).toMatchObject({ allocationPending: true, classUnits: 21 });
    expect(attendanceUnitsDiff(3, pending)).toBeNull();
    expect(teacherTermSessions({ ...term, units: 0 }, "home", weights)).toEqual({ units: 0, daysBasis: false, classUnits: 0 });
    expect(teacherTermSessions({ ...term, daysBasis: true }, "home", weights)).toEqual({ ...term, daysBasis: true });
    expect(teacherTermWeights({ ...base, enrollments: [], schedules: [slot("home", "14:00", "14:40")] }).size).toBe(0);
  });
});
