import { phoneKeyOf } from "@/features/enrollment/same-person";
import { validEventDate } from "./attendance";
import { eventEducationConflicts } from "./education";
import { childNameKey, eventName, guardianNameKey, studentEventPhones, verifiedEventSibling } from "./family";
import type { EventIdentity, EventIdentityMatch, EventReason, EventSiblingLink, EventStudent } from "./types";

/** Identity matching never proves attendance; the attendance policy is evaluated separately. */
export function matchEventIdentity(input: EventIdentity, students: readonly EventStudent[], links: readonly EventSiblingLink[], today: string): EventIdentityMatch {
  const reasons: EventReason[] = [];
  const review = (candidates: string[] = []): EventIdentityMatch => ({ state: "review", studentIds: [], candidates: [...new Set(candidates)].sort(), reasons: [...new Set(reasons)], basis: null });
  if (!input.sourceRef.trim()) reasons.push("source_missing");
  if (!input.eventId.trim()) reasons.push("event_missing");
  if (!validEventDate(input.eventDate) || !validEventDate(today)) reasons.push("event_date_invalid");
  if (!input.tenantId) reasons.push("tenant_unknown");
  if (!input.phones.length) reasons.push("phone_missing");
  const phones = input.phones.map(p => /^\+?[\d\s()-]+$/.test(p.trim()) ? phoneKeyOf(p) : null);
  if (phones.some(p => !p)) reasons.push("phone_invalid");
  if (reasons.length) return review();
  const eligible = students.filter(s => s.eligible && s.tenantId === input.tenantId);
  const byPhone = phones.map(p => eligible.filter(s => studentEventPhones(s).has(p!)));
  const phoned = eligible.filter(s => byPhone.some(group => group.some(x => x.id === s.id)));
  if (phones.some(p => /^010(\d)\1{7}$/.test(p!)) || byPhone.some(group => group.length >= 4
    && group.some(s => !guardianNameKey(s.guardianName) || guardianNameKey(s.guardianName) !== guardianNameKey(group[0]!.guardianName)))) {
    reasons.push("shared_phone"); return review(phoned.map(s => s.id));
  }
  const named = input.studentName ? eligible.filter(s => /[가-힣][a-z]{1,2}$/.test(eventName(input.studentName))
    ? eventName(s.name) === eventName(input.studentName) : childNameKey(s.name) === childNameKey(input.studentName)) : [];
  const matches = input.studentName ? named.filter(s => phoned.some(p => p.id === s.id)) : phoned;
  if (!matches.length || byPhone.some(group => !group.length)) {
    reasons.push(named.length || phoned.length ? "name_phone_conflict" : "student_not_found");
    return review([...named, ...phoned].map(s => s.id));
  }
  if (input.studentName && matches.length !== 1) {
    reasons.push("ambiguous_student"); return review(matches.map(s => s.id));
  }
  // All matching numbers must belong to the same verified household; do not choose a convenient one.
  for (const a of phoned) for (const b of phoned) if (a.id !== b.id && !verifiedEventSibling(a, b, links)) reasons.push("household_conflict");
  if (!input.studentName && (!guardianNameKey(input.guardianName) || matches.some(s => !guardianNameKey(s.guardianName)))) reasons.push("guardian_missing");
  for (const student of matches) {
    if (guardianNameKey(input.guardianName) && guardianNameKey(student.guardianName) && guardianNameKey(input.guardianName) !== guardianNameKey(student.guardianName)) reasons.push("guardian_conflict");
    if (input.studentName) reasons.push(...eventEducationConflicts(input, student, today));
  }
  if (!input.studentName && (input.school || input.grade)) {
    const education = matches.map(student => eventEducationConflicts(input, student, today));
    if (education.every(conflicts => conflicts.length)) reasons.push(...education.flat());
  }
  if (reasons.length) return review(phoned.map(s => s.id));
  return { state: "matched", studentIds: matches.map(s => s.id).sort(), candidates: matches.map(s => s.id).sort(), reasons: [], basis: input.studentName ? "student" : "household" };
}
