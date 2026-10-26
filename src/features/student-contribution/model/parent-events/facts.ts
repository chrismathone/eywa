import type { SourceCoverage, StudentFact } from "@/features/students/ontology/types";
import { emptyRaws } from "../config";
import type { ContributionFact } from "../build";
import { deduplicateEventCredits, type RecognizedEvent } from "./credits";
import { EVENT_POLICY } from "./attendance";
import { kstDateOf } from "@/lib/date-kst";

export type ParentEventRecord = RecognizedEvent & { title: string; attendanceBasis: "explicit_attendance" | "registration_policy" };
export type ParentEventSources = { ready: boolean; checkedAt: string | null; records: ParentEventRecord[]; pendingRows?: number; coverageFrom?: string | null; readError?: boolean };
export const emptyParentEvents = (): ParentEventSources => ({ ready: false, checkedAt: null, records: [] });
export function parentEventCoverage(source: ParentEventSources): SourceCoverage {
  return { source: "student_parent_event_registrations", from: source.coverageFrom ?? source.records.map(r => r.eventDate).sort()[0] ?? null,
    through: kstDateOf(source.checkedAt), state: !source.ready ? "unavailable" : source.pendingRows ? "pending" : "ready",
    note: source.readError ? "설명회 근거를 불러오지 못했습니다. 저장된 점수는 유지하며, 근거는 다시 확인한 뒤 표시합니다."
      : !source.ready ? "설명회 신청·참석 명단을 아직 연결하지 않았습니다. 참석 0회를 뜻하지 않습니다."
      : source.pendingRows ? `이 학원의 미확정 명단 ${source.pendingRows}행은 제외했습니다. 검토를 마친 신청·형제 참여만 포함하며, 미확정 자료는 별도 확인 후 연결합니다.`
      : "검토를 마친 명단만 포함합니다. 취소되지 않은 신청과 확인된 형제 참여를 인정합니다." };
}
/** Only event identity, count and attribution basis enter the monthly payload. No contacts, raw rows or sibling IDs. */
export function parentEventFacts(input: { tenant: string; today: string; capturedAt: string; source: ParentEventSources;
  canonical: (id: string) => string; eligible: (id: string) => boolean }) {
  const { tenant, today, capturedAt, source, canonical, eligible } = input;
  if (!source.ready && source.records.length) throw new Error("설명회 자료의 확인 상태가 일치하지 않습니다");
  const records = source.records.filter(r => eligible(r.studentId));
  const credits = deduplicateEventCredits(tenant, records, canonical, today);
  const byEvent = new Map<string, ParentEventRecord>();
  const originalEvidence = new Map<string, { source: "student_parent_event_registrations"; id: string; studentId: string }[]>();
  const explicit = new Set<string>();
  for (const r of records) {
    if (byEvent.has(r.eventId) && byEvent.get(r.eventId)!.title !== r.title) throw new Error("설명회 이름을 확인해 주세요");
    byEvent.set(r.eventId, r);
    const key = JSON.stringify([r.eventId, canonical(r.studentId)]);
    const refs = originalEvidence.get(key) ?? [];
    refs.push(...r.sourceIds.map(id => ({ source: "student_parent_event_registrations" as const, id, studentId: r.studentId })));
    originalEvidence.set(key, refs);
    if (r.attendanceBasis === "explicit_attendance") explicit.add(key);
  }
  const facts: StudentFact[] = credits.map(c => ({ id: c.id, tenantId: tenant, studentId: c.studentId,
    kind: "parent_event", occurred: { precision: "day", value: c.eventDate }, recordedAt: capturedAt,
    value: { eventId: c.eventId, title: byEvent.get(c.eventId)!.title, familyKeys: c.familyKeys, attribution: c.basis,
      attendanceBasis: explicit.has(JSON.stringify([c.eventId, c.studentId]))
        ? "explicit_attendance" : "registration_policy" },
    related: [{ kind: "academy", id: tenant }],
    evidence: [...new Map(originalEvidence.get(JSON.stringify([c.eventId, c.studentId]))!.map(e => [JSON.stringify(e), e])).values()],
    access: "contribution", basis: "rule", ruleVersion: EVENT_POLICY, state: "active" }));
  const points: ContributionFact[] = credits.map(c => ({ studentId: c.studentId, month: c.eventDate.slice(0, 7),
    raws: { ...emptyRaws(), parentSeminarEvents: 1 }, evidenceIds: [c.id] }));
  return { facts, points, coverage: parentEventCoverage(source) };
}
