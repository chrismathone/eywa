import "server-only";
import { unstable_cache } from "next/cache";
import { parseCalendarSources } from "@/features/calendar/google-import";
import { calendarApi } from "@/features/calendar/server/google-sync-core";
import type { HistoryEvent } from "../evidence";

export const HISTORY_START = "2000-01-01";
export function historySources(tenantId: string) {
  if (process.env.GOOGLE_CALENDAR_TENANT_ID?.trim() !== tenantId) return [];
  const allowed = new Set((process.env.GOOGLE_ENROLLMENT_HISTORY_CALENDAR_IDS ?? "").split(/[;\n]+/).map(s => s.trim()).filter(Boolean));
  return parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS).filter(s => allowed.size
    ? allowed.has(s.calendarId) : /입학.*상담|신입생|시범수업/.test(s.tagName));
}

export async function fetchGoogleHistory(tenantId: string, name: string, today: string) {
  const sources = historySources(tenantId);
  const api = calendarApi();
  if (!sources.length || !api.ok) return { events: [] as HistoryEvent[], complete: false,
    message: "이 학원의 과거 상담 캘린더 연결을 확인해 주세요. 조회 전에는 신규 문의로 확정할 수 없습니다." };
  const results = await Promise.all(sources.map(async (source) => {
    const events: HistoryEvent[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    const started = Date.now();
    try {
      do {
        const res = await api.cal.events.list({ calendarId: source.calendarId, q: name,
          timeMin: HISTORY_START + "T00:00:00+09:00", timeMax: today + "T23:59:59+09:00",
          singleEvents: true, showDeleted: false, maxResults: 250, pageToken,
          // Descriptions may contain credentials: never request, cache or send them to a model.
          fields: "nextPageToken,items(id,iCalUID,status,summary,start,end,htmlLink)",
        }, { timeout: 10_000, retry: false });
        for (const event of res.data.items ?? []) {
          const start = event.start?.dateTime ?? event.start?.date;
          if (!event.id || !start) continue;
          const date = event.start?.date ?? new Date(Date.parse(start) + 9 * 3600_000).toISOString().slice(0,10);
          events.push({ id: event.id, calendarId: source.calendarId, source: source.tagName,
            title: event.summary ?? "", date, start, uid: event.iCalUID,
            cancelled: event.status === "cancelled", url: event.htmlLink });
        }
        pageToken = res.data.nextPageToken ?? undefined;
        pages++;
        if (pageToken && (pages >= 10 || events.length >= 2500 || Date.now()-started >= 20_000))
          return { events, complete: false };
      } while (pageToken);
      return { events, complete: true };
    } catch { return { events, complete: false }; } // No request URLs, names or event bodies in logs.
  }));
  return { events: results.flatMap(r => r.events), complete: results.every(r => r.complete),
    message: results.every(r => r.complete) ? null : "일부 캘린더를 끝까지 읽지 못했습니다. 보이는 기록은 일부일 수 있습니다." };
}

// Authorization is checked on EVERY action call, before entering the tenant-scoped cache.
export function cachedGoogleHistory(tenantId: string, name: string, today: string) {
  return unstable_cache(() => fetchGoogleHistory(tenantId, name, today),
    ["enrollment-history-v1", tenantId, name, today, JSON.stringify(historySources(tenantId))],
    { revalidate: 300 })();
}
