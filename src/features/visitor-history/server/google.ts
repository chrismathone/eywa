import "server-only";
import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import { calendarApi, type CalendarApi } from "@/features/calendar/server/google-sync-core";
import type { CalendarSource } from "@/features/calendar/google-import";
import { eventStart, mergeMonth, reservation, type SourceResult } from "../model";
import { visitorSources } from "./sources";

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  return { timeMin: `${month}-01T00:00:00+09:00`, timeMax: `${next}-01T00:00:00+09:00` };
}
export async function readSource(cal: CalendarApi, source: CalendarSource, month: string): Promise<SourceResult> {
  const result: SourceResult = { source: source.tagName, complete: false, scanned: 0, unclassified: 0, records: [] };
  const started = Date.now(), tokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < 12; page++) {
      const res = await cal.events.list({ calendarId: source.calendarId, ...monthBounds(month),
        singleEvents: true, showDeleted: true, maxResults: 250, timeZone: "Asia/Seoul", pageToken,
        // q searches descriptions too; fetch the entire month and classify ONLY titles.
        fields: "nextPageToken,items(id,iCalUID,status,summary,start,originalStartTime,recurringEventId,htmlLink,updated)",
      }, { timeout: 8_000, retry: false });
      for (const event of res.data.items ?? []) {
        result.scanned++;
        const record = reservation(event, source.tagName, source.calendarId, month);
        if (record) {
          // Opaque keys in client/cache; calendar identifiers need not be exposed.
          record.key = createHash("sha256").update(record.key).digest("hex").slice(0, 24);
          record.occurrence = createHash("sha256").update(record.occurrence).digest("hex");
          result.records.push(record);
        } else if (!event.id || !event.summary || !eventStart(event.start)) result.unclassified++;
      }
      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) { result.complete = true; break; }
      if (tokens.has(pageToken) || Date.now() - started > 16_000) break;
      tokens.add(pageToken);
    }
  } catch { /* Partial history remains explicit; no URLs, credentials or event text in logs. */ }
  return result;
}
export async function fetchVisitorMonth(tenantId: string, month: string) {
  const sources = visitorSources(tenantId), api = calendarApi();
  const checkedAt = new Date().toISOString();
  const scope = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  if (!sources.length || !api.ok) return mergeMonth(month, [], checkedAt);
  // At most 3 calendars concurrently, with a bounded request duration.
  const results: SourceResult[] = [];
  for (let i = 0; i < sources.length; i += 3) {
    results.push(...await Promise.all(sources.slice(i, i + 3).map(s => readSource(api.cal, s, month))));
  }
  return mergeMonth(month, results, checkedAt, scope);
}
export function visitorMonthTag(tenantId: string, month: string) {
  return `visitor-month:${tenantId}:${month}`;
}
export function cachedVisitorMonth(tenantId: string, month: string) {
  return unstable_cache(() => fetchVisitorMonth(tenantId, month),
    ["visitor-history-v1", tenantId, month, JSON.stringify(visitorSources(tenantId))],
    { revalidate: 300, tags: [visitorMonthTag(tenantId, month)] })();
}
