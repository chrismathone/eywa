import { validEventDate } from "./attendance";
export type RecognizedEvent = {
  tenantId: string; eventId: string; eventDate: string; studentId: string; familyKey: string;
  sourceIds: readonly string[]; basis: "direct" | "household" | "sibling";
};
export type EventCredit = RecognizedEvent & { id: string; sourceIds: string[]; familyKeys: string[] };
const priority = { direct: 0, household: 1, sibling: 2 };

/** Input is the complete currently recognized set, not an incremental points ledger. */
export function deduplicateEventCredits(tenant: string, rows: readonly RecognizedEvent[], canonical: (id: string) => string, today: string): EventCredit[] {
  if (!validEventDate(today)) throw new Error("Invalid current date");
  const events = new Map<string, string>(), credits = new Map<string, EventCredit>();
  for (const row of rows) {
    if (row.tenantId !== tenant || !row.eventId || !row.studentId || !row.familyKey || !row.sourceIds.length || row.sourceIds.some(id => !id)) throw new Error("Invalid event credit");
    if (!validEventDate(row.eventDate)) throw new Error("Invalid event date");
    if (events.has(row.eventId) && events.get(row.eventId) !== row.eventDate) throw new Error("Conflicting event dates");
    events.set(row.eventId, row.eventDate);
    if (row.eventDate > today) continue;
    const studentId = canonical(row.studentId);
    if (!studentId) throw new Error("Missing canonical student");
    const id = `parent_event:${encodeURIComponent(row.eventId)}:${encodeURIComponent(studentId)}`;
    const previous = credits.get(id);
    const familyKeys = [...new Set([...(previous?.familyKeys ?? []), row.familyKey])].sort();
    const sourceIds = [...new Set([...(previous?.sourceIds ?? []), ...row.sourceIds])].sort();
    const basis = previous && priority[previous.basis] <= priority[row.basis] ? previous.basis : row.basis;
    credits.set(id, { ...row, studentId, id, basis, familyKey: familyKeys[0]!, familyKeys, sourceIds });
  }
  return [...credits.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function eventCreditCounts(rows: readonly EventCredit[]) {
  return { events: new Set(rows.map(r => r.eventId)).size, students: new Set(rows.map(r => r.studentId)).size,
    studentEvents: rows.length, familyEvents: new Set(rows.flatMap(r => r.familyKeys.map(f => JSON.stringify([r.eventId, f])))).size };
}
