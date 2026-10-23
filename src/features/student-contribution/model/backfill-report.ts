import { isMergedStudent } from "@/features/students/status/merged";
import { judgeBackfill, type ReferrerCandidate } from "./backfill";
import { referralDay } from "./referrals";
import { kstDateOf } from "@/lib/date-kst";
import type { CoreSources } from "../server/source-types";
import type { BillingSeed } from "./billing";
import { contributionIdentity } from "./identity";

export const REFERRAL_BACKFILL_CUTOFF = "2026-10-22";
export function buildBackfillReport(core: Pick<CoreSources, "students" | "enrollments" | "users" | "consultations" | "historyLinks">,
  billing: readonly BillingSeed[]) {
  const canonical = contributionIdentity(core.students);
  const candidates: ReferrerCandidate[] = core.students.map((s) => ({ id: s.id, name: s.name, school: s.school, grade: s.grade,
    parentPhone: s.parent_phone, makeeduNo: s.makeedu_id || core.historyLinks.find((h) => h.student_id === s.id)?.makeedu_no || null,
    excluded: s.is_test || isMergedStudent(s.notes), billMonths: billing.filter((b) => b.studentId === s.id && b.active).map((b) => b.month),
    enrollments: core.enrollments.filter((e) => e.student_id === s.id).map((e) => ({ startDate: e.start_date, endDate: e.end_date,
      onHold: e.on_hold, isTransferred: e.is_transferred })) }));
  const rows = core.consultations.filter((c) => (kstDateOf(c.created_at) ?? "9999") <= REFERRAL_BACKFILL_CUTOFF).map((c) =>
    judgeBackfill({ ...c, student_id: c.student_id ? canonical(c.student_id) : null, day: referralDay(c) ?? "", referrerName: c.referrer_name, path: c.consultation_path,
      body: [c.parent_request, c.safety_notes, c.follow_up_content].filter(Boolean).join("\n"),
      referrerStudentId: c.referrer_student_id, referrerStaffId: c.referrer_staff_id }, candidates, core.users.map((u) => u.display_name)));
  const count = (state: typeof rows[number]["state"]) => rows.filter((r) => r.state === state).length;
  return { cutoff: REFERRAL_BACKFILL_CUTOFF, counts: { total: rows.length, automatic: count("automatic"), review: count("review"),
    unavailable: count("unavailable"), linked: count("linked") }, rows };
}
export type BackfillReport = ReturnType<typeof buildBackfillReport>;
