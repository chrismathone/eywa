import { isCancelledEventTitle } from "@/features/calendar/cancelled";
import { phoneKeyOf, personName } from "@/features/enrollment/same-person";

export type Identity = { name: string; phones: string[] };
export type HistoryEvent = {
  id: string; calendarId: string; source: string; title: string; date: string;
  start: string; uid?: string | null; cancelled: boolean; url?: string | null;
};
export type Evidence = {
  key: string; source: string; date: string; url: string | null;
  match: "name_phone" | "name_only"; cancelled: boolean;
};
export function titleHasName(title: string, name: string): boolean {
  const escaped = [...personName(name.normalize("NFC"))].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
  return !!escaped && new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(title.normalize("NFC"));
}
export function titlePhones(title: string): string[] {
  return (title.match(/(?:\+?82[-.\s]?1\d|01\d)[-.\s]?\d{3,4}[-.\s]?\d{4}/g) ?? []).map(phoneKeyOf).filter((p): p is string => !!p);
}
export function safeCalendarUrl(value: string | null | undefined): string | null {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(u.hostname)
      && /^(\/calendar\/|\/calendar$)/.test(u.pathname) ? u.href : null;
  } catch { return null; }
}

// Event records are evidence candidates, never proof that a consultation happened or a person did not enroll.
// Cross-calendar copies share UID + occurrence. Same-day distinct subjects remain separate records.
export function historyEvidence(events: HistoryEvent[], identity: Identity, today: string) {
  const phones = new Set(identity.phones.map(phoneKeyOf).filter((p): p is string => !!p));
  const seen = new Set<string>();
  const rows: Evidence[] = [];
  let duplicates = 0;
  for (const e of events) {
    if (!titleHasName(e.title, identity.name) || e.date > today) continue;
    const occurrence = Number.isFinite(Date.parse(e.start)) ? new Date(e.start).toISOString() : e.start;
    const key = e.uid ? `${e.uid}:${occurrence}` : `${e.calendarId}:${e.id}`;
    // An active copy should not be hidden by a cancelled copy in a different calendar.
    const cancelled = e.cancelled || isCancelledEventTitle(e.title);
    const dedupeKey = `${key}:${cancelled}`;
    if (seen.has(dedupeKey)) { duplicates++; continue; }
    seen.add(dedupeKey);
    rows.push({ key: dedupeKey, source: e.source, date: e.date, url: safeCalendarUrl(e.url), cancelled,
      match: titlePhones(e.title).some((p) => phones.has(p)) ? "name_phone" : "name_only" });
  }
  rows.sort((a,b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const matched = rows.filter((r) => r.match === "name_phone" && !r.cancelled);
  return { rows, duplicates, matchedRecords: matched.length,
    priorRecords: matched.filter((r) => r.date < today).length,
    visitDates: new Set(matched.map((r) => r.date)).size,
    cancelled: rows.filter((r) => r.cancelled).length,
    ambiguous: rows.filter((r) => r.match === "name_only" && !r.cancelled).length };
}

export type StudentEvidence = { name: string; parent_phone: string | null; student_phone: string | null;
  status: string; enrolled_at: string | null };
export function registrationEvidence(rows: StudentEvidence[], identity: Identity) {
  const phones = new Set(identity.phones.map(phoneKeyOf).filter((p): p is string => !!p));
  const matched = rows.filter((r) => personName(r.name.normalize("NFC")) === personName(identity.name.normalize("NFC"))
    && [r.parent_phone, r.student_phone].some((p) => !!phoneKeyOf(p) && phones.has(phoneKeyOf(p)!)));
  return matched.some((r) => r.enrolled_at || ["enrolled", "on_hold", "withdrawn"].includes(r.status))
    ? "found" as const : "unconfirmed" as const;
}
