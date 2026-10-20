import "server-only";
import { parseCalendarSources } from "@/features/calendar/google-import";

export function visitorSources(tenantId: string) {
  if (!tenantId || process.env.GOOGLE_CALENDAR_TENANT_ID?.trim() !== tenantId) return [];
  const configured = parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS);
  const allowed = new Set((process.env.GOOGLE_VISITOR_HISTORY_CALENDAR_IDS ?? "")
    .split(/[;\n]+/).map(s => s.trim()).filter(Boolean));
  // Owner scope: admission counseling ONLY, never trial classes/operations.
  const sources = configured.filter(s => /입학상담/.test(s.tagName.replace(/\s/g, ""))
    && (!allowed.size || allowed.has(s.calendarId)));
  return [...new Map(sources.map(s => [s.calendarId, s])).values()];
}
