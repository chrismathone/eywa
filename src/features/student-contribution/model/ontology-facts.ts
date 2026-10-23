import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import { videoHomeworkOutcomes } from "@/features/video-homework/auto-outcomes";
import { uniqueStudentFacts } from "@/features/students/ontology/facts";
import type { EntityRef, EvidenceRef, StudentFact, StudentRelation } from "@/features/students/ontology/types";
import type { CoreSources } from "../server/source-types";
import type { ActivitySources } from "../server/activity-sources";
import type { contributionCalendar } from "./calendar";
import type { BillingSeed } from "./billing";
import { referralDay, type ReferralCredit } from "./referrals";

/** 원자료 → 학생 사실. 점수·추측을 사실 값에 섞지 않고, 당시 관계와 원본 학생 id를 남긴다. */
export function studentOntology(input: { tenant: string; today: string; capturedAt: string; core: CoreSources; activity: ActivitySources;
  billing: BillingSeed[]; referrals: ReferralCredit[]; canonical: (id: string) => string; calendar: ReturnType<typeof contributionCalendar> }) {
  const { tenant, core, activity, canonical, calendar } = input;
  const known = new Set(core.students.map((s) => s.id));
  const classes = new Map(core.classes.map((c) => [c.id, c]));
  const facts: StudentFact[] = [], relations: StudentRelation[] = [];
  const ev = (source: EvidenceRef["source"], id: string, studentId: string): EvidenceRef => ({ source, id, studentId });
  const related = (student: string, classId: string | null, day: string, subject?: string | null): EntityRef[] => {
    const refs: EntityRef[] = [{ kind: "academy", id: tenant }, { kind: "student", id: canonical(student) }];
    const c = classId ? classes.get(classId) : null;
    if (c) {
      refs.push({ kind: "class", id: c.id }, { kind: "subject", id: c.subject });
      const cd = calendar.context.classDays(day).find((d) => d.c.id === c.id);
      // 해당 날짜의 수업 근거가 없으면 현재 담당자를 과거 수강에 붙이지 않는다.
      const teachers = cd?.slotTeachers ?? [];
      for (const id of new Set(teachers)) if (id) refs.push({ kind: "teacher", id });
    } else if (subject) refs.push({ kind: "subject", id: subject });
    return refs;
  };
  const add = (student: string, fact: Omit<StudentFact, "tenantId" | "studentId" | "recordedAt" | "state"> & Partial<Pick<StudentFact, "recordedAt" | "state">>) => {
    if (known.has(student)) facts.push({ tenantId: tenant, studentId: canonical(student), recordedAt: input.capturedAt, state: "active", ...fact });
  };
  for (const b of input.billing) add(b.studentId, { id: `tuition:${b.id}`, kind: "tuition", occurred: { precision: "month", value: b.month },
    value: { tuitionWon: b.tuitionWon, subjects: b.subjects, active: b.active, unknownSubjects: b.unknownSubjects }, basis: "rule", ruleVersion: "tuition-v1", access: "billing",
    related: [{ kind: "academy", id: tenant }, ...b.subjects.map((id): EntityRef => ({ kind: "subject", id }))],
    evidence: b.evidenceIds.map((id) => ev(id.startsWith("history:") ? "makeedu_history_bills" : "invoices", id.slice(id.indexOf(":") + 1), b.studentId)) });
  for (const e of core.enrollments) {
    if (!known.has(e.student_id) || e.start_date > input.today) continue;
    const evidence = [ev("enrollments", e.id, e.student_id)], end = enrollmentLastDate(e.end_date, e.is_transferred);
    const refs = related(e.student_id, e.class_id, e.start_date);
    add(e.student_id, { id: `enrollment:${e.id}`, kind: "enrolled", value: { start: e.start_date, end, onHold: e.on_hold },
      occurred: { precision: "day", value: e.start_date }, related: refs, evidence, access: "student", basis: "recorded" });
    relations.push({ tenantId: tenant, from: { kind: "student", id: canonical(e.student_id) }, to: { kind: "class", id: e.class_id },
      kind: "enrolledIn", validFrom: e.start_date, validTo: end, evidence });
  }
  for (const c of core.consultations) {
    const day = referralDay(c);
    if (!c.student_id || !known.has(c.student_id) || !day || day > input.today) continue;
    add(c.student_id, { id: `consultation:${c.id}`, kind: "consulted", value: { subject: c.subject }, occurred: { precision: "day", value: day },
      related: related(c.student_id, null, day, c.subject), evidence: [ev("enrollment_consultations", c.id, c.student_id)], basis: "recorded", access: "student", recordedAt: c.created_at });
  }
  for (const r of input.referrals) {
    const evidence = [ev("enrollment_consultations", r.consultationId, r.referrerId)];
    add(r.referrerId, { id: `referral:${r.consultationId}:${r.subject}`, kind: "referred", value: { prospectId: r.prospectId, subject: r.subject, startedOn: r.startedOn },
      occurred: { precision: "day", value: r.consultedOn }, related: related(r.referrerId, null, r.consultedOn, r.subject), evidence, basis: "rule", ruleVersion: "referral-v1", access: "contribution" });
    if (r.prospectId) relations.push({ tenantId: tenant, from: { kind: "student", id: r.referrerId }, to: { kind: "student", id: r.prospectId },
      kind: "referred", validFrom: r.consultedOn, validTo: null, evidence });
  }
  for (const a of effectiveAttendanceRecords(activity.attendance)) {
    if (!known.has(a.student_id)) continue;
    const refs = related(a.student_id, a.class_id, a.session_date);
    const cd = calendar.context.classDays(a.session_date).find((d) => d.c.id === a.class_id);
    const teacher = cd?.axisOf(a.slot_start).teacherId;
    // 교시가 확인되면 그 교시 담당으로 좁힌다.
    const exactRefs = teacher ? [...refs.filter((r) => r.kind !== "teacher"), { kind: "teacher" as const, id: teacher }] : refs;
    const evidence = [ev("attendance_records", a.id, a.student_id)];
    add(a.student_id, { id: `attendance:${a.id}`, kind: "attendance", value: { status: a.status, slot: a.slot_start, seat: a.seat_label },
      occurred: { precision: "day", value: a.session_date }, recordedAt: a.recorded_at, related: exactRefs, evidence, basis: "recorded", access: "student" });
    if (teacher) relations.push({ tenantId: tenant, from: { kind: "student", id: canonical(a.student_id) }, to: { kind: "teacher", id: teacher },
      kind: "taughtBy", validFrom: a.session_date, validTo: a.session_date, evidence });
  }
  const { outcomes } = videoHomeworkOutcomes(activity.assignments, activity.videos, input.today, "2026-01-01", activity.marks);
  for (const o of outcomes) {
    if (!o.videoId || !known.has(o.studentId)) continue;
    add(o.studentId, { id: `homework:${o.videoId}`, kind: "homework", value: { status: o.status, homeworkDate: o.homeworkDate },
      occurred: { precision: "day", value: o.homeworkDate }, related: related(o.studentId, o.classId, o.homeworkDate),
      evidence: [ev("student_homework_videos", o.videoId, o.studentId)], basis: "rule", ruleVersion: "video-ledger-v1", access: "student" });
  }
  for (const g of activity.grades) {
    if (!known.has(g.student_id)) continue;
    const source = g.id.startsWith("report:") ? "lesson_reports" : "student_grades";
    add(g.student_id, { id: `exam:${g.id}`, kind: "exam", value: { kind: g.kind, subject: g.subject, score: g.score, max: g.max },
      occurred: { precision: "day", value: g.day }, related: related(g.student_id, g.class_id, g.day, g.subject),
      evidence: [ev(source, g.id.split(":")[1] ?? g.id, g.student_id)], basis: "recorded", access: "student" });
  }
  const signalState = new Map(activity.signals.map((s) => [s.id, s]));
  for (const s of activity.signalRows) {
    if (!known.has(s.student_id)) continue;
    add(s.student_id, { id: `observation:${s.id}`, kind: "observation", value: { classification: s.classification, evidence: s.evidence,
      author: s.author_label, model: s.model_label, source: s.source }, occurred: { precision: "day", value: s.occurred_on },
      recordedAt: s.judged_at, related: related(s.student_id, null, s.occurred_on),
      evidence: [ev(s.source === "parent" ? "classnote_parent_messages" : "classnote_parent_replies", s.source_id, s.student_id), ev("student_positive_signals", s.id, s.student_id)],
      basis: s.model_label ? "ai" : "rule", access: "contribution", state: s.cancelled_at ? "cancelled" : !signalState.get(s.id)?.sourceCurrent ? "pending" : "active" });
  }
  for (const c of core.classes) relations.push({ tenantId: tenant, from: { kind: "class", id: c.id }, to: { kind: "subject", id: c.subject },
    kind: "subjectOf", validFrom: null, validTo: c.closed_at, evidence: core.enrollments.filter((e) => e.class_id === c.id).slice(0, 1).map((e) => ev("enrollments", e.id, e.student_id)) });
  return { facts: uniqueStudentFacts(tenant, [facts]), relations };
}
