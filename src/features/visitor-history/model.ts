import { isCancelledEventTitle } from "@/features/calendar/cancelled";
import { isValidYmd } from "@/lib/date-kst";

export type Category = "consultation" | "entrance" | "test";
export const CATEGORY_LABEL: Record<Category, string> = {
  consultation: "상담", entrance: "입학테스트·입테", test: "테스트",
};
export type Reservation = {
  key: string; occurrence: string; date: string; time: string | null;
  title: string; source: string; category: Category | null;
  status: "active" | "cancelled" | "review"; reason: string | null;
  url: string | null; updated: number;
};
export type SourceResult = {
  source: string; complete: boolean; scanned: number; unclassified: number;
  records: Reservation[];
};
export type MonthHistory = {
  month: string; checkedAt: string; scope: string; complete: boolean; sources: Omit<SourceResult, "records">[];
  records: Reservation[]; duplicates: number;
};
export type CalendarEvent = {
  id?: string | null; iCalUID?: string | null; summary?: string | null;
  status?: string | null; htmlLink?: string | null; updated?: string | null;
  recurringEventId?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  originalStartTime?: { date?: string | null; dateTime?: string | null } | null;
};

export function classify(title: string) {
  const compact = title.normalize("NFKC").replace(/\s+/g, "");
  if (/신입생|첫등원|첫수업|등원|시범수업|체험수업/.test(compact)) return null;
  if (/(?:상담|입테|테스트|레테)(?:예약)?(?:금지|불가|없음)|상담[Xx×✕]+$|상담일정조율완료/.test(compact)) return null;
  const entrance = /입학테스트|입테/.test(compact);
  const test = /테스트|레테/.test(compact);
  const consultation = /상담/.test(compact);
  if (!entrance && !test && !consultation) return null;
  const category: Category = entrance ? "entrance" : test ? "test" : "consultation";
  const reason = /재원|학부모|어머니|아버지|진로|직원|강사|채용|면접|전화|통화|온라인|줌|zoom|재시험|재테스트|월말|단원|수행평가|시스템|문자테스트|테스트문자|회의|미팅|알려줄|부재중|상담일지|상담기록/i.test(compact)
    ? "신규 방문 예약인지 확인 필요"
    : /변경|연기|이동/.test(compact) ? "일정 변경·연기 여부 확인" : null;
  return { category, reason };
}

/** No descriptions, contact details, attendees or raw API error text reach the view/cache. */
export function displayTitle(title: string): string {
  return title.replace(/(?:\+82[-.\s]?)?0?\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[연락처 숨김]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일 숨김]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
}
export function safeCalendarUrl(raw: string | null | undefined): string | null {
  try {
    const u = new URL(raw ?? "");
    return u.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(u.hostname)
      && u.pathname.startsWith("/calendar") && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export function eventStart(value: CalendarEvent["start"]) {
  if (value?.date && isValidYmd(value.date)) return { date: value.date, time: null, occurrence: value.date };
  // Reject timezone-less timestamps: machine timezone must never affect the month.
  const raw = value?.dateTime;
  if (!raw || !/(Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) return null;
  const iso = new Date(Date.parse(raw) + 9 * 3600_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), occurrence: String(Date.parse(raw)) };
}
export function reservation(event: CalendarEvent, source: string, calendarId: string, month: string): Reservation | null {
  const start = eventStart(event.start);
  if (!event.id || !start || !start.date.startsWith(month + "-")) return null;
  const title = event.summary ?? "";
  const classification = classify(title);
  if (!classification) return null;
  const noShow = /노쇼|noshow/i.test(title.normalize("NFKC").replace(/\s+/g, ""));
  const cancelled = event.status === "cancelled" || isCancelledEventTitle(title) || noShow;
  const occurrence = event.recurringEventId || event.originalStartTime
    ? eventStart(event.originalStartTime)?.occurrence ?? start.occurrence : "single";
  return {
    key: `${calendarId}:${event.id}`, occurrence: event.iCalUID ? `${event.iCalUID}:${occurrence}` : `${calendarId}:${event.id}`,
    date: start.date, time: start.time, title: displayTitle(title), source, category: classification.category,
    status: cancelled ? "cancelled" : classification.reason || event.status === "tentative" ? "review" : "active",
    reason: cancelled ? noShow ? "노쇼 표시" : "취소 표시" : classification.reason ?? (event.status === "tentative" ? "미확정 예약" : null),
    url: safeCalendarUrl(event.htmlLink), updated: Date.parse(event.updated ?? "") || 0,
  };
}

/** Shared UID + occurrence only. Equal names/titles are NOT sufficient identity evidence. */
export function mergeMonth(month: string, sources: SourceResult[], checkedAt: string, scope = ""): MonthHistory {
  const groups = new Map<string, Reservation[]>();
  for (const record of sources.flatMap(s => s.records)) {
    groups.set(record.occurrence, [...(groups.get(record.occurrence) ?? []), record]);
  }
  const records = [...groups.values()].map(group => {
    const sorted = [...group].sort((a, b) => b.updated - a.updated || a.key.localeCompare(b.key));
    const latest = sorted[0];
    const conflict = group.some(r => r.status !== latest.status || r.date !== latest.date || r.time !== latest.time || r.category !== latest.category);
    return { ...latest, source: [...new Set(group.map(r => r.source))].sort().join(" · "),
      ...(conflict ? { status: "review" as const, reason: "같은 예약의 사본 정보가 달라 확인 필요" } : {}) };
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.key.localeCompare(b.key));
  return { month, checkedAt, scope, complete: sources.length > 0 && sources.every(s => s.complete),
    sources: sources.map(s => ({ source: s.source, complete: s.complete, scanned: s.scanned, unclassified: s.unclassified })), records,
    duplicates: sources.reduce((n, s) => n + s.records.length, 0) - records.length };
}

export function counts(history: MonthHistory) {
  const active = history.records.filter(r => r.status === "active");
  return { active: active.length, consultation: active.filter(r => r.category === "consultation").length,
    entrance: active.filter(r => r.category === "entrance").length,
    test: active.filter(r => r.category === "test").length,
    cancelled: history.records.filter(r => r.status === "cancelled").length,
    review: history.records.filter(r => r.status === "review").length };
}
/** A moved copy can straddle month boundaries. Hold both records, rather than double-count demand. */
export function reconcileMonths(history: Record<string, MonthHistory>): Record<string, MonthHistory> {
  const seen = new Map<string, Set<string>>();
  for (const h of Object.values(history)) for (const r of h.records) {
    const key = `${h.scope}:${r.occurrence}`;
    const months = seen.get(key) ?? new Set<string>();
    months.add(h.month); seen.set(key, months);
  }
  return Object.fromEntries(Object.entries(history).map(([month, h]) => [month, { ...h,
    records: h.records.map(r => (seen.get(`${h.scope}:${r.occurrence}`)?.size ?? 0) > 1
      ? { ...r, status: "review" as const, reason: "다른 달에도 같은 예약 사본이 있어 확인 필요" } : r),
  }]));
}
export function comparison(current: MonthHistory | undefined, prior: MonthHistory | undefined, today: string): string {
  if (!current?.complete || !prior?.complete || current.scope !== prior.scope || current.month >= today.slice(0, 7)) return "비교 보류";
  const now = counts(current).active, before = counts(prior).active;
  if (!before) return now ? "전년 0건" : "변동 없음";
  const percent = Math.round((now - before) / before * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}
