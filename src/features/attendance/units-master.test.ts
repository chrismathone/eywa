import { describe, expect, it } from "vitest";
import { buildMasterStudent, masterOwner, masterPlan, masterStatus, masterMatchesFilter, masterPriority, type MasterRecord } from "./units-master";
import type { TermShareSchedule } from "./teacher-term-share";

const slot = (startTime: string, endTime: string, teacherId: string | null = "home", slotTeacherLabel: string | null = null): TermShareSchedule => ({
  dayOfWeek: "mon", startTime, endTime, teacherId, slotTeacherLabel, validFrom: "2026-09-01", validTo: null,
});
const schedules = [slot("09:00", "09:50"), slot("10:00", "10:50", null, "JJ"), slot("11:00", "11:50", null, "LAB")];
const record = (id: string, start: string | null, extra: Partial<MasterRecord> = {}): MasterRecord => ({
  id, class_id: "c", student_id: "s", session_date: "2026-09-07", slot_start: start, status: "present", session_units: null,
  recorded_at: "2026-09-07T04:00:00Z", seat_label: null, recorded_via: null, ...extra,
});
const plan = masterPlan({ from: "2026-09-07", to: "2026-09-07", schedules, homeroomTeacherId: "home", englishTrack: "injaewon", className: "중2 정규", holidays: new Set() });
const base = {
  student: { id: "s", name: "학생", school: "학교" }, schedules, homeroomTeacherId: "home", from: "2026-09-01", to: "2026-09-30", asOf: "2026-09-30T23:59",
  enrollments: [{ startDate: "2026-09-01", endDate: null, isTransferred: false, attendanceDays: null }],
  plan, allocation: new Map([["home", 1], ["JJ", 1], ["LAB", 1]]), term: { units: 3, daysBasis: false }, invoice: "ok" as const, sessionUnmapped: false,
};

describe("English units master: actual lessons, not duplicated teacher views", () => {
  it("includes all teachers, JJ without seat_label, and LAB exactly once", () => {
    const row = buildMasterStudent({ ...base, records: [record("a", "09:00"), record("b", "10:00", { recorded_via: "seat" }), record("c", "11:00", { seat_label: "LAB" })] });
    expect(row.actual).toBe(3); expect(row.status).toBe("complete");
    expect(Object.fromEntries(Object.entries(row.owners).map(([k, v]) => [k, v.actual]))).toEqual({ home: 1, JJ: 1, LAB: 1 });
  });
  it("normalizes time and keeps only the latest correction, including tie-break", () => {
    const row = buildMasterStudent({ ...base, plan: [], records: [record("a", "09:00:00"), record("z", "09:00", { session_units: 5 })] });
    expect(row.actual).toBe(5); expect(row.events).toHaveLength(1); expect(row.status).toBe("excess");
  });
  it("uses manually entered units and never restricts excess", () => {
    const row = buildMasterStudent({ ...base, plan: [], records: [record("a", "09:00", { session_units: 7.5, status: "makeup" })] });
    expect(row.actual).toBe(7.5); expect(row.remaining).toBe(-4.5);
  });
  it("counts absence/excused as zero, but distinguishes missing attendance", () => {
    const row = buildMasterStudent({ ...base, records: [record("a", "09:00", { status: "absent", session_units: 9 }), record("b", "10:00", { status: "excused" })] });
    expect(row.actual).toBe(0); expect(row.missing).toBe(1); expect(row.status).toBe("review");
  });
  it("excludes *LAB from actuals and the plan, with an audit event", () => {
    const slots = schedules.map((s) => ({ ...s, labSeparate: s.slotTeacherLabel === "LAB" }));
    const row = buildMasterStudent({ ...base, schedules: slots, plan: [], records: [record("a", "11:00", { seat_label: "LAB" })] });
    expect(row.actual).toBe(0); expect(row.events[0]).toMatchObject({ excluded: true, note: "*LAB · 합계 제외" });
    expect(masterPlan({ from: "2026-09-07", to: "2026-09-07", schedules: slots, homeroomTeacherId: "home", englishTrack: "injaewon", className: "정규", holidays: new Set() })).toHaveLength(2);
  });
  it("does not sum a daily aggregate on top of period records", () => {
    const row = buildMasterStudent({ ...base, plan: [], records: [record("a", null, { session_units: 3 }), record("b", "09:00"), record("c", "10:00")] });
    expect(row.actual).toBe(2); expect(row.status).toBe("review"); expect(row.events.find((r) => !r.slot)?.excluded).toBe(true);
  });
  it("a daily row shown to multiple teachers stays one fact and flags ownership", () => {
    const row = buildMasterStudent({ ...base, records: [record("a", null, { session_units: 3 })] });
    expect(row.actual).toBe(3); expect(row.owners.unassigned.actual).toBe(3); expect(row.status).toBe("review");
  });
  it("does not generate actuals from a homeroom remainder allocation", () => {
    const row = buildMasterStudent({ ...base, plan: [], term: { units: 4, daysBasis: false }, records: [] });
    expect(row.owners.home.planned).toBe(2); expect(row.actual).toBe(0); expect(row.remaining).toBe(4);
  });
  it("counts future lessons separately and does not mark today's unfinished period missing", () => {
    const row = buildMasterStudent({ ...base, asOf: "2026-09-07T09:30", records: [] });
    expect(row.future).toBe(3); expect(row.missing).toBe(0); expect(row.status).toBe("normal");
  });
  it("honors per-student enrollment boundaries and attendance days", () => {
    const row = buildMasterStudent({ ...base, enrollments: [{ startDate: "2026-09-08", endDate: null, isTransferred: false, attendanceDays: null }], records: [] });
    expect(row.missing).toBe(0);
    const moved = buildMasterStudent({ ...base, enrollments: [{ startDate: "2026-09-01", endDate: "2026-09-07", isTransferred: true, attendanceDays: null }], records: [] });
    expect(moved.missing).toBe(0);
  });
  it("retains real attendance outside enrollment, but never attendance outside the period", () => {
    const row = buildMasterStudent({ ...base, enrollments: [], records: [record("a", "09:00"), record("b", "09:00", { session_date: "2026-08-31" })] });
    expect(row.actual).toBe(1); expect(row.missing).toBe(0);
  });
  it("does not claim completion for an unknown or days-based target", () => {
    expect(buildMasterStudent({ ...base, term: undefined, records: [] }).status).toBe("unconfirmed");
    expect(buildMasterStudent({ ...base, term: { units: 3, daysBasis: true }, records: [] }).target).toBeNull();
  });
  it("does not silently consider unmatched EiE calendar dates to be the four-session registration", () => {
    const row = buildMasterStudent({ ...base, sessionUnmapped: true, plan: [], records: [record("a", "09:00", { session_units: 3 })] });
    expect(row.actual).toBe(3); expect(row.status).toBe("review");
  });
  it("adds a makeup reservation only once and recognizes its completed record", () => {
    const futureLesson = { date: "2026-09-08", start: "12:00", end: "13:00", owner: "home", units: 1 };
    const row = buildMasterStudent({ ...base, plan: [], asOf: "2026-09-07T23:59", reservations: [futureLesson, futureLesson], records: [] });
    expect(row.future).toBe(1);
    const done = buildMasterStudent({ ...base, plan: [], reservations: [futureLesson], records: [record("a", "12:00", { session_date: "2026-09-08", status: "makeup" })] });
    expect(done.actual).toBe(1); expect(done.future).toBe(0); expect(done.missing).toBe(0);
  });
});

describe("shared planning and owner rules", () => {
  it("plans math with the attendance convention: each 55-minute lesson is 0.5U", () => {
    const mathSlots = [slot("14:30", "15:25"), slot("15:25", "16:20"), slot("16:20", "17:15")];
    const rows = masterPlan({ from: "2026-09-07", to: "2026-09-07", schedules: mathSlots,
      subject: "math", homeroomTeacherId: "home", englishTrack: null, className: "수학", holidays: new Set() });
    expect(rows.map((r) => r.units)).toEqual([0.5, 0.5, 0.5]);
    expect(rows.reduce((n, r) => n + r.units, 0)).toBe(1.5);
    const student = buildMasterStudent({ ...base, schedules: mathSlots, allocation: new Map([["home", 1.5]]), plan: rows, records: [record("day", null, { session_units: 1.5 })], term: { units: 1.5, daysBasis: false } });
    expect(student).toMatchObject({ actual: 1.5, missing: 0, status: "complete" });
  });
  it("math plans exclude seat-only and separate LAB slots, deduplicate the same start", () => {
    const rows = masterPlan({ from: "2026-09-07", to: "2026-09-07", subject: "math", schedules: [slot("14:30", "15:25"), slot("14:30", "15:25"), slot("16:20", "17:15", null, "JJ"), slot("17:15", "18:10", null, "*LAB")],
      homeroomTeacherId: "home", englishTrack: null, className: "수학", holidays: new Set() });
    expect(rows).toHaveLength(1); expect(rows[0].units).toBe(0.5);
  });
  it("an unconfirmed target does not hide attendance-input work in filters", () => {
    const row = buildMasterStudent({ ...base, term: undefined, records: [] });
    expect(row.status).toBe("unconfirmed");
    expect(masterMatchesFilter(row, "unconfirmed")).toBe(true);
    expect(masterMatchesFilter(row, "review")).toBe(true);
    expect(masterMatchesFilter(row, "attention")).toBe(true);
    expect(masterPriority(row)).toBe(0);
  });
  it("prioritizes input problems before a pending confirmation without input problems", () => {
    const row = buildMasterStudent({ ...base, term: undefined, plan: [], records: [] });
    expect(masterMatchesFilter(row, "review")).toBe(false);
    expect(masterPriority(row)).toBe(2);
  });
  it("uses recorded substitute-teacher ownership, preserving seat facts and total units", () => {
    const row = buildMasterStudent({ ...base, plan: [], records: [record("a", "09:00", { taught_by: "substitute" }), record("b", "10:00", { taught_by: "substitute", recorded_via: "seat" })] });
    expect(row.actual).toBe(2);
    expect(row.owners.substitute.actual).toBe(1);
    expect(row.owners.JJ.actual).toBe(1);
    expect(row.events.some((e) => e.note === "실제 수업 강사로 귀속")).toBe(true);
  });
  it("uses existing LAB aliases", () => expect(masterOwner([slot("09:00", "09:40", null, "이주희")], "home", "2026-09-07", "09:00")).toBe("LAB"));
  it("never attributes an unknown seat record to homeroom", () => expect(masterOwner([], "home", "2026-09-07", "09:00", null, "seat")).toBe("unassigned"));
  it("keeps hourly 50-minute lessons at 1U and skips holidays", () => {
    expect(plan.map((p) => p.units)).toEqual([1, 1, 1]);
    expect(masterPlan({ from: "2026-09-07", to: "2026-09-07", schedules, homeroomTeacherId: "home", englishTrack: "injaewon", className: "정규", holidays: new Set(["2026-09-07"]) })).toEqual([]);
  });
  it("shares the bridge half-teaching rule with teacher registration", () => {
    const schedules = [slot("15:00", "15:40", "k"), slot("15:40", "16:20", "home"), slot("16:20", "17:00", "home"), slot("17:00", "17:40", "f")];
    const plan = masterPlan({ from: "2026-09-07", to: "2026-09-07", schedules, homeroomTeacherId: "home", englishTrack: "injaewon", className: "브릿지", holidays: new Set() });
    expect(plan.map((p) => p.units)).toEqual([0.5, 1, 1, 0.5]);
  });
  it("distinguishes incomplete, completed and future excess", () => {
    const row = { target: 3, actual: 2, future: 0, missing: 0, review: [] };
    expect(masterStatus(row)).toBe("short");
    expect(masterStatus({ ...row, actual: 3 })).toBe("complete");
    expect(masterStatus({ ...row, future: 2 })).toBe("plannedExcess");
  });
});
