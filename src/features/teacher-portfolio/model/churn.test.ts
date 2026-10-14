import { describe, expect, it } from "vitest";
import { buildChurn } from "./churn";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "./types";
const c = { id: "math", subject: "math", class_name: "수학반", teacher_id: "home", closed_at: null } as SnapshotClass;
const slot = { id: "slot", class_id: "math", teacher_id: "period", day_of_week: "tue", valid_from: "2026-01-01", valid_to: null } as SnapshotSchedule;
const e = { id: "e", student_id: "s", class_id: "math", start_date: "2026-01-01", end_date: "2026-10-06", on_hold: false, attendance_days: [], is_transferred: false, is_transferred_in: false, withdrawal_reason: "schedule" } as SnapshotEnrollment;
const window = { start: "2026-10-01", end: "2026-10-13" };
const model = (over: { classes?: SnapshotClass[]; schedules?: SnapshotSchedule[]; enrollments?: SnapshotEnrollment[] } = {}) => buildChurn({ classes: [c], schedules: [slot], enrollments: [e], owner: k => k.teacher_id, ...over });
describe("withdrawal rate uses all actual assigned teachers", () => {
  it("counts homeroom and every teaching-period teacher equally", () => {
    const m = model({ schedules: [slot, { ...slot, id: "slot2", teacher_id: "period2" }] });
    for (const id of ["home", "period", "period2"]) expect([m.period(id, window).raw, m.period(id, window).detail.length]).toEqual([100, 1]);
    expect(m.period("unrelated", window).raw).toBeNull();
  });
  it("deduplicates repeated teaching periods and multiple ended subjects per student", () => {
    const m = model({ schedules: [slot, { ...slot, id: "duplicate" }, { ...slot, id: "other", class_id: "english" }], classes: [c, { ...c, id: "english", subject: "english" }], enrollments: [e, { ...e, id: "other", class_id: "english" }] });
    expect(m.period("period", window).detail).toHaveLength(1);
    expect(m.period("period", window).raw).toBe(100);
  });
  it("respects attendance weekdays and expired period assignments", () => {
    expect(model({ enrollments: [{ ...e, attendance_days: ["thu"] }] }).period("period", window).raw).toBeNull();
    expect(model({ schedules: [{ ...slot, valid_to: "2026-08-31" }] }).period("period", window).raw).toBeNull();
  });
  it("excludes transfers, short special lectures and the four exempt reasons", () => {
    for (const reason of ["graduated", "relocation", "illness", "advised"]) expect(model({ enrollments: [{ ...e, withdrawal_reason: reason }] }).period("home", window).raw).toBe(0);
    expect(model({ enrollments: [{ ...e, is_transferred: true }] }).period("home", window).raw).toBe(0);
    expect(model({ classes: [{ ...c, is_special: true }] }).period("home", window).raw).toBeNull();
  });
  it("does not count a class ending when the subject continues elsewhere", () => {
    const m = model({ classes: [c, { ...c, id: "other", teacher_id: "other" }], enrollments: [e, { ...e, id: "other", class_id: "other", start_date: "2026-10-06", end_date: null }] });
    expect(m.period("home", window).raw).toBe(0);
  });
  it("a previous transfer ending on the same day cannot hide the final subject withdrawal", () => {
    const m = model({ classes: [c, { ...c, id: "old", teacher_id: "previous" }], enrollments: [e, { ...e, id: "old", class_id: "old", is_transferred: true }] });
    expect(m.period("home", window).raw).toBe(100);
    expect(m.period("period", window).detail).toHaveLength(1);
  });
  it("eligibleSubjects = teachers with a denominator and the subjects they taught those students (timetable X overlay reads this)", () => {
    const m = model({ schedules: [slot, { ...slot, id: "eng", class_id: "english", teacher_id: "native" }], classes: [c, { ...c, id: "english", subject: "english", teacher_id: "home" }], enrollments: [e, { ...e, id: "en", class_id: "english", end_date: null }] });
    const subjects = m.eligibleSubjects(window);
    expect([...subjects.get("home") ?? []].sort()).toEqual(["english", "math"]);
    expect([...subjects.get("period") ?? []]).toEqual(["math"]);
    expect([...subjects.get("native") ?? []]).toEqual(["english"]);
    expect(subjects.has("unrelated")).toBe(false);
  });
  it("keeps denominator complete and uses actual owner history", () => {
    const m = buildChurn({ classes: [c], schedules: [slot], enrollments: [e, { ...e, id: "staying", student_id: "stay", end_date: null }], owner: () => "previousHome" });
    expect(m.period("previousHome", window).raw).toBe(50);
    expect(m.period("home", window).raw).toBeNull();
  });
});
