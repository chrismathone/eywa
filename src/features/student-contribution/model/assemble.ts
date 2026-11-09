import { groupBy } from "@/features/teacher-portfolio/model/dates";
import { shiftMonth } from "@/lib/date-kst";
import type { SourceCoverage } from "@/features/students/ontology/types";
import type { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import type { CoreSources, RawHistoryBill } from "../server/source-types";
import type { ActivitySources } from "../server/activity-sources";
import { billingMonths, type HistoricalBill } from "./billing";
import { contributionSubjectOf } from "./subjects";
import { contributionIdentity } from "./identity";
import { contributionRoster } from "./roster";
import { contributionCalendar } from "./calendar";
import { referralEvidence } from "./start-evidence";
import { recognizeReferrals } from "./referrals";
import { monthlyParticipation } from "./participation";
import { contributionFacts, buildStudentMonths } from "./build";
import { METRICS, METRIC_LABELS, emptyRaws, type ContributionConfig, type Metric } from "./config";
import { emptyPayload, type StoredContributionMonth } from "./stored";
import { studentOntology } from "./ontology-facts";
import { buildBackfillReport } from "./backfill-report";
import { correctionDetails } from "./corrections";
import { pendingDetails } from "./pending-details";
import { contributionLessonNames, contributionSubjectEvidence, lessonKey } from "./subject-evidence";
import { reviewedHistoricalSubject } from "./reviewed-subjects";
import { enrolledMonthCounts } from "./enrolled-months";
import { emptyParentEvents, parentEventFacts, type ParentEventSources } from "./parent-events/facts";
import { buildRankingFacts } from "./ranking-facts";

export function assembleContribution(input: { tenant: string; today: string; capturedAt: string; core: CoreSources; activity: ActivitySources;
  settings: Awaited<ReturnType<typeof getTenantSettingsByTenantId>>; config: ContributionConfig; stored: StoredContributionMonth[];
  history: RawHistoryBill[] | null; historyReady: boolean; parentEvents?: ParentEventSources }) {
  const { core, activity, today, capturedAt, tenant, config } = input;
  const month = today.slice(0, 7), canonical = contributionIdentity(core.students);
  const known = new Set(core.students.map((s) => s.id));
  const test = new Set(core.students.filter((s) => s.is_test).map((s) => s.id));
  const eligible = (id: string) => known.has(id) && !test.has(id) && !test.has(canonical(id));
  const events = parentEventFacts({ tenant, today, capturedAt, canonical, eligible, source: input.parentEvents ?? emptyParentEvents() });
  if (!input.parentEvents?.ready && input.stored.some(r => r.raws.parentSeminarEvents || r.correction.parentSeminarEvents))
    throw new Error("이전에 연결한 설명회 자료를 읽지 못해 집계를 멈췄습니다. 자료를 확인한 뒤 다시 집계해 주세요.");
  const names = contributionLessonNames(core.invoices, input.history ?? []);
  const staff = core.users.map(u => ({ names: [u.display_name, u.english_name], subjects: u.subjects ?? [] }));
  const evidence = contributionSubjectEvidence({ names, subjects: input.settings.operations.subjects, staff, classes: core.classes, teachers: core.lessonTeachers ?? [] });
  const subjectOf = contributionSubjectOf({ subjects: input.settings.operations.subjects, classes: core.classes, names,
    staff, evidence });
  const link = new Map(core.historyLinks.filter((h) => h.student_id).map((h) => [h.makeedu_no, h.student_id!]));
  const subjectKeys = new Set(input.settings.operations.subjects.map(s => s.key));
  const evidenceByName = groupBy(evidence, e => lessonKey(e.name));
  const rawHistory: HistoricalBill[] = (input.history ?? []).flatMap((h) => {
    const id = link.get(h.makeedu_no);
    const reviewed = reviewedHistoricalSubject(tenant, h), reviewedSubject = reviewed && subjectKeys.has(reviewed.subject) ? reviewed.subject : null;
    const subject = reviewedSubject ?? subjectOf({ name: h.item_name }), billId = `${h.makeedu_no}:${h.bill_month}:${h.seq}`;
    const sources = reviewedSubject ? [{ subject: reviewedSubject, basis: reviewed!.basis, reference: reviewed!.reference }]
      : (evidenceByName.get(lessonKey(h.item_name ?? "")) ?? []).filter(e => e.subject === subject);
    return id && eligible(id) ? [{ id: billId, studentId: id, month: h.bill_month.slice(0, 7), lesson: h.item_kind === "lesson",
      billed: Number(h.billed), paid: Number(h.paid), refunded: h.refunded, name: h.item_name ?? "수업명 없음",
      subject, subjectResolutions: [...new Map(sources.map(e => [e.reference, { billId, month: h.bill_month.slice(0, 7), name: h.item_name ?? "수업명 없음",
        subject: e.subject, basis: e.basis, reference: e.reference }])).values()] }] : [];
  });
  const cached = [...new Map(input.stored.flatMap((r) => r.historical).map((s) => [s.id, s])).values()].filter((s) => eligible(s.studentId));
  const originals = billingMonths({ invoices: core.invoices.filter((r) => eligible(r.student_id)), history: rawHistory,
    cachedHistory: input.history === null ? cached : undefined, through: month, aywaFrom: "2026-01", subjectOf });
  // 원본별 캐시는 원래 학생 id를 유지한다. 병합은 읽을 때만 해석하여 동일 seed를 두 번 더하지 않는다.
  const historySeeds = originals.filter((b) => b.month < "2026-01").map((b) => b.seed);
  const billing = billingMonths({ invoices: core.invoices.filter((r) => eligible(r.student_id)).map((r) => ({ ...r, student_id: canonical(r.student_id) })),
    history: [], cachedHistory: historySeeds.map((b) => ({ ...b, studentId: canonical(b.studentId) })), through: month, aywaFrom: "2026-01", subjectOf });
  const enrolledMonths = enrolledMonthCounts(billing.map((b) => b.seed));
  const enrollmentIds = new Set(core.enrollments.map((e) => canonical(e.student_id)));
  const roster = contributionRoster(core.students, enrollmentIds);
  const calendar = contributionCalendar(core, { tenant, today, capturedAt, holidays: input.settings.operations.holidays, attendance: activity.attendance });
  const referrals = recognizeReferrals({ rows: core.consultations.filter((c) => (!c.student_id || eligible(c.student_id)) && (!c.referrer_student_id || eligible(c.referrer_student_id))),
    today, options: config.referrals, canonicalStudent: canonical, evidenceFor: referralEvidence(core, billing, activity.attendance, canonical) });
  const remap = <T extends { studentId: string }>(rows: T[]) => rows.filter((r) => eligible(r.studentId)).map((r) => ({ ...r, studentId: canonical(r.studentId) }));
  const targets = groupBy(calendar.targets.filter((r) => eligible(r.student_id)).map((r) => ({ ...r, student_id: canonical(r.student_id) })), (r) => r.student_id);
  const attendance = groupBy(activity.attendance.filter((r) => eligible(r.student_id)).map((r) => ({ ...r, student_id: canonical(r.student_id) })), (r) => r.student_id);
  const assigned = groupBy(remap(activity.assignments), (r) => r.studentId), videos = groupBy(remap(activity.videos), (r) => r.studentId);
  const marks = groupBy(remap(activity.marks), (r) => r.studentId), signals = groupBy(remap(activity.signals), (r) => r.studentId);
  const grades = groupBy(remap(activity.grades.map((g) => ({ ...g, studentId: g.student_id }))), (r) => r.studentId);
  const pendingSignals = remap(activity.pendingSignals);
  const pending = new Set(pendingSignals.map((s) => `${s.studentId}:${s.day.slice(0, 7)}:${s.source}`));
  const participation = roster.flatMap((student) => {
    const id = student.id, out = [];
    for (let m = "2026-01"; m <= month; m = shiftMonth(m, 1)) {
      const result = monthlyParticipation({ studentId: id, month: m, today, allowLate: config.attendance.allowLate,
        targets: targets.get(id) ?? [], attendance: attendance.get(id) ?? [], assignments: assigned.get(id) ?? [], videos: videos.get(id) ?? [],
        marks: marks.get(id) ?? [], grades: grades.get(id) ?? [], signals: signals.get(id) ?? [],
        ready: { attendance: true, video: true, grades: true, positive: {
          parent: activity.aiLicensed && !pending.has(`${id}:${m}:parent`), teacher: activity.aiLicensed && !pending.has(`${id}:${m}:teacher`),
        } } });
      if (METRICS.some((key) => result.raws[key]) || m === month || (targets.get(id) ?? []).some((t) => t.session_date.startsWith(m)))
        out.push({ studentId: id, month: m, ...result });
    }
    return out;
  });
  const ontology = studentOntology({ tenant, today, capturedAt, core, activity, billing: originals.map((b) => b.seed), referrals: referrals.credits, canonical, calendar });
  ontology.facts.push(...events.facts);
  const factsByStudent = groupBy(ontology.facts, (f) => f.studentId);
  // 점수가 없는 상담·수강·출결도 첫 복원에서 학생의 해당 달에 연결한다.
  const recordMonths = [...new Map(ontology.facts.map((f) => [`${f.studentId}:${f.occurred.value.slice(0, 7)}`, {
    studentId: f.studentId, month: f.occurred.value.slice(0, 7), raws: emptyRaws(), evidenceIds: [] as string[],
  }])).values()];
  const pointsByStudent = groupBy(contributionFacts(billing, referrals.credits, [...participation, ...recordMonths, ...events.points]), (f) => f.studentId);
  const storedByStudent = groupBy(input.stored, (r) => r.studentId);
  const seedsByStudent = groupBy(historySeeds, (s) => canonical(s.studentId));
  const billingByStudent = groupBy(billing.map(b => b.seed), b => b.studentId);
  const schoolByStudent = groupBy((activity.schoolGrades ?? []).filter(g => eligible(g.student_id)).map(g => ({ ...g, student_id: canonical(g.student_id) })), g => g.student_id);
  const unavailable = new Map(participation.map((p) => [`${p.studentId}:${p.month}`, p.unavailable]));
  const coverage: SourceCoverage[] = [
    events.coverage,
    { source: "makeedu_history_bills", from: "2020-01", through: "2025-12", state: "ready", note: "학생 번호로 연결된 청구만 포함. EiE는 2025-05부터. 청구 달 기준이며 정확한 휴원 기간 기록은 없습니다." },
    { source: "invoices", from: "2026-01", through: month, state: "ready" },
    { source: "attendance_records", from: "2026-01-01", through: today, state: "ready", note: "월~일 예정된 정규 수업에 모두 출석한 주를 인정. 종료된 주만 일요일의 달에 반영하며, 과거 휴원 구간은 별도 기록이 없습니다." },
    { source: "student_homework_videos", from: activity.assignments.map((a) => a.date).sort()[0] ?? null, through: today, state: "ready", note: "실제 제출 영상이 하나 이상 연결된 숙제마다 1회 인정. 같은 숙제의 여러 영상은 중복 계산하지 않습니다." },
    { source: "student_grades", from: "2026-01-01", through: today, state: "ready" },
    { source: "classnote_parent_messages", from: activity.signalSources.filter((s) => s.source === "parent").map((s) => s.day).sort()[0] ?? null,
      through: today, state: !activity.aiLicensed || activity.pendingSignals.length ? "pending" : "ready", note: "출결 연락 제외 · 원문 변경 시 재판정 필요" },
    { source: "classnote_parent_replies", from: "2026-09-30", through: today, state: !activity.aiLicensed || activity.pendingSignals.length ? "pending" : "ready", note: "에이와에서 성공적으로 보낸 답글만" },
    { source: "enrollment_consultations", from: core.consultations.map((c) => c.consultation_date).filter((d): d is string => !!d).sort()[0] ?? null,
      through: today, state: "ready", note: "연결된 소개만 인정 · 지난 소개는 별도 확인 목록" },
  ];
  // 랭킹도 기여도 설명회 점수(parentEventFacts)와 같은 대상 필터를 쓴다(테스트·미상 학생 제외).
  const rankingEvents = input.parentEvents ? { ...input.parentEvents, records: input.parentEvents.records.filter(r => eligible(r.studentId)) } : emptyParentEvents();
  const rows = roster.flatMap((student): StoredContributionMonth[] => {
    const loyaltyRanking = buildRankingFacts({ studentId: student.id, asOf: today, billing: billingByStudent.get(student.id) ?? [],
      targets: targets.get(student.id) ?? [], attendance: attendance.get(student.id) ?? [], grades: schoolByStudent.get(student.id) ?? [],
      events: rankingEvents, canonical });
    const saved = storedByStudent.get(student.id) ?? [], savedMap = new Map(saved.map((r) => [r.month, r]));
    const facts = factsByStudent.get(student.id) ?? [];
    const points = pointsByStudent.get(student.id) ?? [];
    const built = buildStudentMonths({ month, capturedAt, facts: points, stored: saved, complete: true, reconstruct: !input.historyReady });
    return built.map((r) => {
      const old = savedMap.get(r.month);
      if (old?.closedAt) return old;
      const corrections = METRICS.filter((key) => r.correction[key] !== 0);
      const inMonth = facts.filter((f) => f.occurred.value.startsWith(r.month));
      const incomplete: Metric[] = [...(unavailable.get(`${student.id}:${r.month}`) ?? [])];
      if (config.rates.parentSeminarEvents.enabled && events.coverage.state !== "ready") incomplete.push("parentSeminarEvents");
      const ownPending = pendingSignals.filter(s => s.studentId === student.id && (r.month === month || s.day.startsWith(r.month)));
      if (ownPending.some(s => s.source === "parent")) incomplete.push("parentPositiveMonths");
      if (ownPending.some(s => s.source === "teacher")) incomplete.push("teacherPositiveMonths");
      const unknownBills = billing.filter(b => b.studentId === student.id && b.unknownSubjects > 0 && (r.month === month || b.month === r.month));
      if (unknownBills.length) incomplete.push("subjectMonths");
      const details = pendingDetails(incomplete).map(d => {
        if (d.metric === "subjectMonths") return { ...d, months: [...new Set(unknownBills.map(b => b.month))].sort(), lessons: [...new Set(unknownBills.flatMap(b => b.seed.unknownNames ?? []))].sort() };
        if (d.metric === "parentPositiveMonths" || d.metric === "teacherPositiveMonths") {
          const items = ownPending.filter(s => s.source === (d.metric === "parentPositiveMonths" ? "parent" : "teacher"));
          return { ...d, count: items.length, months: [...new Set(items.map(s => s.day.slice(0, 7)))].sort(),
            reason: activity.aiLicensed ? d.reason : "긍정 신호 판정 기능이 꺼져 있어 아직 판정하지 않은 자료를 확인할 수 없습니다." };
        }
        return d;
      });
      const relationRows = ontology.relations.filter((rel) => (rel.from.kind === "student" && rel.from.id === student.id)
        && (!rel.validFrom || rel.validFrom.slice(0, 7) <= r.month) && (!rel.validTo || rel.validTo.slice(0, 7) >= r.month));
      const ownCoverage = coverage.map(entry => {
        const source = entry.source === "classnote_parent_messages" ? "parent" : entry.source === "classnote_parent_replies" ? "teacher" : null;
        return source ? { ...entry, state: !activity.aiLicensed || ownPending.some(s => s.source === source) ? "pending" as const : "ready" as const } : entry;
      });
      // A frozen month cannot be rewritten: preserve newly verified historical sources on the open month's payload.
      const subjectResolutions = (seedsByStudent.get(student.id) ?? []).filter(s => r.month === month || s.month === r.month).flatMap(s => s.subjectResolutions ?? []);
      return { ...r, studentId: student.id, computedAt: capturedAt, historical: (seedsByStudent.get(student.id) ?? []).filter((s) => s.month === r.month), unavailable: [...new Set(incomplete)],
        payload: { ...emptyPayload(), ...(r.month === month ? { enrolledMonths: enrolledMonths.get(student.id) ?? 0, loyaltyRanking } : {}), evidenceIds: r.evidenceIds, facts: inMonth, relations: relationRows, coverage: ownCoverage, unavailableDetails: details, subjectResolutions,
          corrections: correctionDetails(r, built.filter((b) => !!b.closedAt), points),
          subjects: [...new Set(inMonth.flatMap((f) => f.related.filter((e) => e.kind === "subject").map((e) => e.id)))],
          correctionReasons: corrections.map((metric) => ({ metric, delta: r.correction[metric], reason: `${METRIC_LABELS[metric]}: 오늘 원본의 누적 수치와 마감한 달의 합계 차이(환불·연결 변경·병합·판정 변경 포함)` })) } };
    });
  });
  return { rows, roster, coverage, backfill: buildBackfillReport(core, originals.map((b) => b.seed)), pendingReferrals: referrals.pending };
}
