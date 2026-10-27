import { childNameKey, eventName } from "../../../src/features/student-contribution/model/parent-events/family";
import type { EventAttendance } from "../../../src/features/student-contribution/model/parent-events/types";
import type { ParsedRegistration } from "./source-types";
import { ambiguousAbsence } from "../../../src/features/student-contribution/model/parent-events/attendance";
/** A parent-only cancellation can contradict a named application; a different sibling's application remains independent. */
export function conflictingRegistrations(decisions: { row: ParsedRegistration; attendance: EventAttendance }[]) {
  const groups = new Map<string, Set<number>>(), conflicts = new Set<number>();
  const add = (key: string, index: number) => { const group = groups.get(key) ?? new Set<number>(); group.add(index); groups.set(key, group); };
  decisions.forEach((d, index) => {
    d.row.phones.forEach(phone => add(JSON.stringify(["phone", d.row.tenantId, d.row.eventId, phone]), index));
    if (d.row.studentName) add(JSON.stringify(["name", d.row.tenantId, d.row.eventId, childNameKey(d.row.studentName)]), index);
  });
  for (const indices of groups.values()) for (const a of indices) for (const b of indices) {
    if (a >= b) continue;
    const left = decisions[a]!, right = decisions[b]!;
    // A name-only cancellation holds plausible matches; two distinct complete phone identities stay separate.
    if (left.row.phones.length && right.row.phones.length && !left.row.phones.some(p => right.row.phones.includes(p))) continue;
    const ln = eventName(left.row.studentName), rn = eventName(right.row.studentName);
    const sameChild = !ln || !rn || ln === rn || (childNameKey(ln) === childNameKey(rn) && (!/[a-z]{1,2}$/.test(ln) || !/[a-z]{1,2}$/.test(rn)));
    if (!sameChild) continue;
    const states = [left.attendance.state, right.attendance.state];
    if (states.includes("recognized") && states.some(s => s === "cancelled" || s === "review")) { conflicts.add(a); conflicts.add(b); }
  }
  return conflicts;
}
export function crossEventAbsences(rows: ParsedRegistration[]) {
  const conflicts = new Set<string>();
  for (const source of rows) for (const marker of source.markers) {
    const value = marker.value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    if (marker.kind !== "other_event_attendance" || !(/^(?:x|×|✕|false|0|n|no|불)$/.test(value) || ambiguousAbsence.test(value))) continue;
    for (const target of rows) if (target.tenantId === source.tenantId && marker.targetEventIds?.includes(target.eventId)
      && target.phones.some(phone => source.phones.includes(phone))) conflicts.add(target.sourceId);
  }
  return conflicts;
}
