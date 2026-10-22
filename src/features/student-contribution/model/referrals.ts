import { samePersonGroups, type PersonRow } from "@/features/enrollment/same-person";
import { registrationStartedOn, type StartEvidence } from "@/features/dashboard/overview/coverage-rules";
import { kstDateOf } from "@/lib/date-kst";
import { addCalendarMonths, isDay } from "./dates";
import type { ContributionConfig } from "./config";

export type Referral = PersonRow & {
  referrer_student_id: string | null; referrer_staff_id: string | null;
  consultation_date: string | null; received_date: string | null; created_at: string;
  subject: string | null;
};
export type ReferralCredit = { consultationId: string; referrerId: string; prospectId: string | null;
  personKey: string; subject: string; consultedOn: string; startedOn: string | null };
export const referralDay = (row: Referral) => row.consultation_date ?? row.received_date ?? kstDateOf(row.created_at);

/** 마지막 '인정' 상담 기준으로 다시 셈. 중간의 중복 상담은 12개월 시계를 밀지 않는다. */
export function recognizeReferrals(input: {
  rows: readonly Referral[]; today: string; options: ContributionConfig["referrals"];
  evidenceFor: (studentId: string, subject: string) => StartEvidence;
  canonicalStudent?: (id: string) => string;
}) {
  const canonical = input.canonicalStudent ?? ((id: string) => id);
  const rows = input.rows.map((r) => ({ ...r, student_id: r.student_id ? canonical(r.student_id) : null,
    referrer_student_id: r.referrer_student_id ? canonical(r.referrer_student_id) : null }));
  const groups = samePersonGroups(rows);
  const linkedPerson = new Map<string, string>();
  for (const row of rows) if (row.student_id) linkedPerson.set(groups.get(row.id)!, row.student_id);
  const last = new Map<string, string>();
  const credits: ReferralCredit[] = [];
  const pending: { consultationId: string; reason: string }[] = [];
  const ordered = rows.flatMap((row) => {
    const day = referralDay(row);
    return day && isDay(day) && day <= input.today ? [{ row, day }] : [];
  }).sort((a, b) => a.day.localeCompare(b.day) || a.row.id.localeCompare(b.row.id));
  for (const { row, day } of ordered) {
    const prospectId = linkedPerson.get(groups.get(row.id)!) ?? row.student_id;
    if (!row.referrer_student_id || row.referrer_staff_id || prospectId === row.referrer_student_id) continue;
    const subjects = [...new Set((row.subject ?? "").split(",").map((s) => s.trim()).filter(Boolean))].sort();
    if (!subjects.length) { pending.push({ consultationId: row.id, reason: "과목 확인 필요" }); continue; }
    const personKey = groups.get(row.id)!;
    const targetSubjects = input.options.key === "student" ? [subjects.join(",")] : subjects;
    for (const subject of targetSubjects) {
      const key = `${personKey}\0${input.options.key === "student" ? "" : subject}`;
      const previous = last.get(key);
      if (previous && day < addCalendarMonths(previous, input.options.months)) continue;
      last.set(key, day);
      const starts = prospectId ? (input.options.key === "student" ? subjects : [subject]).flatMap((s) => {
        const started = registrationStartedOn({ id: prospectId, enrolledAt: day }, input.evidenceFor(prospectId, s), input.today, true);
        return started ? [started] : [];
      }) : [];
      credits.push({ consultationId: row.id, referrerId: row.referrer_student_id, prospectId,
        personKey, subject, consultedOn: day, startedOn: starts.sort()[0] ?? null });
    }
  }
  // 같은 시작 근거가 12개월 떨어진 두 상담에 붙지 않게 다음 인정 상담 이전까지만 이 상담 몫이다.
  const next = new Map<string, string>();
  for (const credit of [...credits].reverse()) {
    const key = `${credit.personKey}\0${input.options.key === "student" ? "" : credit.subject}`;
    const nextDay = next.get(key);
    if (credit.startedOn && nextDay && credit.startedOn >= nextDay) credit.startedOn = null;
    next.set(key, credit.consultedOn);
  }
  return { credits, pending };
}
