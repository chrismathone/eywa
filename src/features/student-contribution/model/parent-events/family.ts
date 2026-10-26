import { personName, phoneKeyOf } from "@/features/enrollment/same-person";
import { resolveSiblingIds, siblingBasis } from "@/features/students/siblings";
import type { EventAttribution, EventSiblingLink, EventStudent } from "./types";
import { eventGuardianNames, eventGuardiansCompatible } from "./guardian";

export const eventName = (value: string | null | undefined) => personName(value?.normalize("NFKC"));
export const childNameKey = (value: string | null | undefined) => eventName(value).replace(/^(.*[가-힣])[a-z]{1,2}$/, "$1");
/** Relationship labels and placeholders cannot establish a shared parent's identity. */
export const guardianNameKey = (value: string | null | undefined) => eventGuardianNames(value).join("/");
const person = (s: EventStudent) => ({ id: s.id, name: s.name, parent_name: s.guardianName, parent_phone: s.guardianPhone });
export function explicitSiblings(anchorId: string, links: readonly EventSiblingLink[]) {
  return new Map(links.filter(l => l.student_a === anchorId || l.student_b === anchorId)
    .map(l => [l.student_a === anchorId ? l.student_b : l.student_a, l.linked]));
}
export function verifiedEventSibling(a: EventStudent, b: EventStudent, links: readonly EventSiblingLink[]) {
  if (!a.eligible || !b.eligible || a.id === b.id || a.tenantId !== b.tenantId || childNameKey(a.name) === childNameKey(b.name)) return false;
  const explicit = explicitSiblings(a.id, links).get(b.id);
  if (explicit !== undefined) return explicit;
  // The profile's name-only suggestion is insufficient for automatic attribution of a historical event.
  if (siblingBasis(person(a), person(b)) !== "phone") return false;
  return eventGuardiansCompatible(a.guardianName, b.guardianName);
}
export function eventFamilyAttributions(anchorId: string, students: readonly EventStudent[], links: readonly EventSiblingLink[]): EventAttribution[] {
  const anchor = students.find(s => s.id === anchorId && s.eligible);
  if (!anchor) return [];
  const explicit = explicitSiblings(anchorId, links);
  const auto = students.filter(s => verifiedEventSibling(anchor, s, links)).map(s => s.id);
  const ids = resolveSiblingIds(auto, explicit);
  return [{ studentId: anchorId, anchorId, basis: "direct" }, ...students
    .filter(s => ids.includes(s.id) && verifiedEventSibling(anchor, s, links))
    .map(s => ({ studentId: s.id, anchorId, basis: explicit.get(s.id) ? "explicit_sibling" as const : "phone" as const }))];
}
export function studentEventPhones(student: EventStudent) {
  return new Set([phoneKeyOf(student.guardianPhone), phoneKeyOf(student.studentPhone)].filter((v): v is string => !!v));
}
