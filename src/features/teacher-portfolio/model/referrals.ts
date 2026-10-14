/**
 * 원생 소개 — 콜&상담에 '소개한 사람'이 이어진 상담을 소개한 원생의 **상담일 담임**(직원이 직접 소개했으면 그 직원)에게 1건씩
 * (원장 결정 7, 2026-10-13 *"누구 소개로 왔다"가 인정된 경우에만* · *"상담만 받아도 인정"* · *"1건당 5점"*). 순수 함수.
 *
 * - 인정 = 직원이 콜&상담에서 원생·직원을 **골라 이은** 것만(신청서에 글로 적은 이름만으로는 세지 않는다).
 * - 같은 사람(이어진 원생, 없으면 이름·학교·학년)은 여러 번 상담해도 **처음 상담 한 번**만.
 * - 상담일 = 상담일 → 접수일 → 만든 날(한국). 그 달에 든 소개만 그 달 수치.
 * - 담임 = 소개한 원생이 그날 다니던 반(보강 묶음 제외)의 그날 담임(담임 이력). 같은 강사의 반이 여럿이어도 1건.
 *   세는 법 '같은 과목'이면 상담 과목 반의 담임만(그 과목 반이 없으면 전원 — options.ts).
 */
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import type { ReferralOptions } from "../evaluation/options";
import { between, groupBy, kstDateOf, unique } from "./dates";
import { METRIC_MAX, type ExpansionMetric, type PeriodWindow, type ReferralRow, type SnapshotClass, type SnapshotEnrollment, type SnapshotReferral } from "./types";

const norm = (v: string | null) => (v ?? "").replace(/\s+/g, "").toLowerCase();
const personOf = (r: SnapshotReferral) => (r.student_id ? `s:${r.student_id}` : `n:${norm(r.prospect_name)}|${norm(r.prospect_school)}|${norm(r.prospect_grade)}`);
const dayOf = (r: SnapshotReferral) => r.consultation_date ?? r.received_date ?? kstDateOf(r.created_at);

export function buildReferrals(input: {
  referrals: readonly SnapshotReferral[]; enrollments: readonly SnapshotEnrollment[]; classes: ReadonlyMap<string, SnapshotClass>;
  owner: (c: SnapshotClass, day: string) => string | null; options: ReferralOptions;
}): (teacherId: string, w: PeriodWindow) => ExpansionMetric {
  const first = new Map<string, { r: SnapshotReferral; day: string }>();
  const dated = input.referrals.flatMap((r) => { const day = dayOf(r); return day ? [{ r, day }] : []; })
    .sort((a, b) => a.day.localeCompare(b.day) || a.r.id.localeCompare(b.r.id));
  for (const x of dated) if (!first.has(personOf(x.r))) first.set(personOf(x.r), x);

  const enrollmentsOf = groupBy(input.enrollments, (e) => e.student_id);
  const credits = new Map<string, ReferralRow[]>();
  for (const { r, day } of first.values()) {
    let teachers: string[] = [];
    if (r.referrer_staff_id) teachers = [r.referrer_staff_id];
    else if (r.referrer_student_id) {
      const live = (enrollmentsOf.get(r.referrer_student_id) ?? [])
        .filter((e) => isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred }, day))
        .flatMap((e) => { const c = input.classes.get(e.class_id); return c && !c.is_makeup_pool ? [c] : []; });
      const subjects = (r.subject ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const same = input.options.attribution === "sameSubject" ? live.filter((c) => subjects.includes(c.subject)) : [];
      teachers = unique((same.length ? same : live).map((c) => input.owner(c, day)).filter((t): t is string => Boolean(t)));
    }
    for (const t of teachers) {
      const row: ReferralRow = { consultationId: r.id, day, prospect: r.prospect_name ?? "", referrerStudentId: r.referrer_student_id, byStaff: Boolean(r.referrer_staff_id), subject: r.subject };
      credits.set(t, [...(credits.get(t) ?? []), row]);
    }
  }

  return (teacherId, w) => {
    const detail = (credits.get(teacherId) ?? []).filter((x) => between(x.day, w.start, w.end));
    return {
      id: "expansion", max: METRIC_MAX.expansion, value: null, raw: detail.length, detail,
      basis: `인정된 소개 ${detail.length}건`,
      reason: "콜&상담에서 '소개한 사람'을 원생·직원으로 이은 상담만 셉니다(상담만 받아도 인정). 소개한 원생의 상담일 담임(직원이 직접 소개했으면 그 직원)에게 1건이고, 같은 사람을 여러 번 상담해도 처음 한 번만 셉니다.",
    };
  };
}
