import { describe, expect, it } from "vitest";
import { buildReferrals } from "./referrals";
import type { SnapshotClass, SnapshotEnrollment, SnapshotReferral } from "./types";

/** 원생 소개 — 이은 소개만 · 소개한 원생의 상담일 담임(또는 소개한 직원) · 같은 사람 한 번(원장 결정 7). */
const cls = (id: string, subject: string, teacher: string): SnapshotClass => ({
  id, class_name: id, subject, english_track: null, teacher_id: teacher, is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false,
});
const enr = (student: string, classId: string, start = "2026-01-01", end: string | null = null): SnapshotEnrollment => ({
  id: `${student}|${classId}`, student_id: student, class_id: classId, start_date: start, end_date: end, on_hold: false, attendance_days: [], is_transferred: false, is_transferred_in: false,
});
const ref = (over: Partial<SnapshotReferral>): SnapshotReferral => ({
  id: "r1", referrer_student_id: "kid", referrer_staff_id: null, consultation_date: "2026-10-05", received_date: null, created_at: "2026-10-05T00:00:00Z",
  subject: "math", student_id: null, prospect_name: "새친구", prospect_school: "침산중", prospect_grade: "중1", ...over,
});
const classes = new Map([cls("m", "math", "T-math"), cls("e", "english", "T-eng")].map((c) => [c.id, c]));
const enrollments = [enr("kid", "m"), enr("kid", "e")];
const oct = { month: "2026-10", start: "2026-10-01", end: "2026-10-31", partial: false };
const run = (referrals: SnapshotReferral[], attribution: "all" | "sameSubject" = "all") =>
  buildReferrals({ referrals, enrollments, classes, owner: (c) => c.teacher_id, options: { attribution } });

describe("원생 소개", () => {
  it("소개한 원생의 상담일 담임 전원에게 1건 — '같은 과목'이면 상담 과목 반의 담임만", () => {
    expect([run([ref({})])("T-math", oct).raw, run([ref({})])("T-eng", oct).raw]).toEqual([1, 1]);
    const same = run([ref({})], "sameSubject");
    expect([same("T-math", oct).raw, same("T-eng", oct).raw]).toEqual([1, 0]);
    // 상담 과목 반이 없으면 전원.
    const other = run([ref({ subject: "science" })], "sameSubject");
    expect([other("T-math", oct).raw, other("T-eng", oct).raw]).toEqual([1, 1]);
  });
  it("직원이 직접 소개했으면 그 직원 · 같은 사람은 처음 상담 한 번만 · 다른 달은 그 달에", () => {
    const f = run([
      ref({ id: "a", referrer_student_id: null, referrer_staff_id: "T-desk" }),
      ref({ id: "b", consultation_date: "2026-10-20" }), // 같은 사람(이름·학교·학년) — 앞 상담만
      ref({ id: "c", prospect_name: "다른친구", consultation_date: "2026-09-30" }),
    ]);
    expect(f("T-desk", oct).raw).toBe(1);
    expect(f("T-math", oct).raw).toBe(0);
    expect(f("T-math", { ...oct, month: "2026-09", start: "2026-09-01", end: "2026-09-30" }).raw).toBe(1);
  });
  it("소개한 원생이 그날 다니던 반이 없으면 아무에게도 주지 않는다", () => {
    const f = buildReferrals({ referrals: [ref({})], enrollments: [enr("kid", "m", "2026-11-01")], classes, owner: (c) => c.teacher_id, options: { attribution: "all" } });
    expect([f("T-math", oct).raw, f("T-math", oct).detail]).toEqual([0, []]);
  });
});
