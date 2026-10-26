import { decideEventAttendance } from "../../../src/features/student-contribution/model/parent-events/attendance";
import { deduplicateEventCredits, eventCreditCounts, type RecognizedEvent } from "../../../src/features/student-contribution/model/parent-events/credits";
import { eventFamilyAttributions, eventName, verifiedEventSibling } from "../../../src/features/student-contribution/model/parent-events/family";
import { matchEventIdentity } from "../../../src/features/student-contribution/model/parent-events/identity";
import type { EventSiblingLink, EventStudent } from "../../../src/features/student-contribution/model/parent-events/types";
import { hash } from "./source-values";
import type { ParsedRegistration } from "./source-types";
import { conflictingRegistrations, crossEventAbsences } from "./registration-conflicts";

export function evaluateRegistrations(input: { tenantId: string; today: string; rows: ParsedRegistration[];
  students: EventStudent[]; links: EventSiblingLink[]; canonical: (id: string) => string }) {
  const { tenantId, today, rows, students, links, canonical } = input;
  const decisions = rows.map(row => {
    const attendance = decideEventAttendance({ eligibleList: row.eligibleList, eventDate: row.eventDate, today, markers: row.markers });
    const identity = matchEventIdentity(row, students, links, today);
    return { row, attendance, identity, reasons: [...new Set([...row.issues, ...attendance.reasons, ...identity.reasons])],
      registrationKey: hash([row.eventId, eventName(row.studentName), row.phones]) };
  });
  const crossSourceConflicts = conflictingRegistrations(decisions);
  const crossEventConflicts = crossEventAbsences(rows);
  const content = new Map<string, Set<string>>(), states = new Map<string, Set<string>>();
  const eventsByDay = new Map<string, Set<string>>();
  for (const d of decisions) {
    const versions = content.get(d.row.sourceId) ?? new Set<string>(); versions.add(d.row.contentHash); content.set(d.row.sourceId, versions);
    const seen = states.get(d.registrationKey) ?? new Set<string>(); seen.add(d.attendance.state); states.set(d.registrationKey, seen);
    if (d.row.tenantId === tenantId && d.row.eligibleList && d.row.eventId) {
      const ids = eventsByDay.get(d.row.eventDate) ?? new Set<string>(); ids.add(d.row.eventId); eventsByDay.set(d.row.eventDate, ids);
    }
  }
  const recognized: RecognizedEvent[] = [];
  const outcomes = decisions.map((d, index) => {
    if (content.get(d.row.sourceId)!.size > 1) d.reasons.push("source_identity_collision");
    const seen = states.get(d.registrationKey)!;
    if (seen.has("recognized") && (seen.has("cancelled") || seen.has("review"))) d.reasons.push("registration_status_conflict");
    if (crossSourceConflicts.has(index)) d.reasons.push("registration_status_conflict");
    if (crossEventConflicts.has(d.row.sourceId)) d.reasons.push("cross_source_absence");
    if ((eventsByDay.get(d.row.eventDate)?.size ?? 0) > 1 && !d.row.sameDayReviewed) d.reasons.push("event_identity_unconfirmed");
    const state = !d.row.eligibleList ? "excluded" : d.reasons.length ? "review" : d.attendance.state;
    const anchors = students.filter(s => d.identity.studentIds.includes(s.id));
    const attributions = state === "recognized" ? d.identity.studentIds.flatMap(id => eventFamilyAttributions(id, students, links))
      .filter(a => anchors.every(anchor => anchor.id === a.studentId
        || verifiedEventSibling(anchor, students.find(s => s.id === a.studentId)!, links))) : [];
    // Use the verified direct household set, never a transitive connected component.
    const familyKey = hash([...new Set(attributions.map(a => canonical(a.studentId)))].sort());
    for (const a of attributions) recognized.push({ tenantId, eventId: d.row.eventId, eventDate: d.row.eventDate,
      studentId: a.studentId, familyKey, sourceIds: [d.row.sourceId],
      basis: a.basis === "direct" ? d.identity.basis === "household" ? "household" : "direct" : "sibling" });
    return { ...d, state, attributions, reasons: [...new Set(d.reasons)].sort() };
  });
  const initial = deduplicateEventCredits(tenantId, recognized, canonical, today);
  const ambiguousSources = new Set(initial.filter(c => c.familyKeys.length > 1).flatMap(c => c.sourceIds));
  for (const d of outcomes) if (ambiguousSources.has(d.row.sourceId)) {
    d.state = "review"; d.attributions = []; d.reasons.push("household_partition_conflict");
  }
  const accepted = recognized.filter(r => !r.sourceIds.some(id => ambiguousSources.has(id)));
  const credits = deduplicateEventCredits(tenantId, accepted, canonical, today);
  return { outcomes, credits, counts: eventCreditCounts(credits), duplicateAttributions: accepted.length - credits.length };
}
