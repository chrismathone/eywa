import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ list: vi.fn(), api: vi.fn() }));
vi.mock("@/features/calendar/server/google-sync-core", () => ({ calendarApi: mock.api }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
import { fetchVisitorMonth, monthBounds, readSource } from "./google";
import { visitorSources } from "./sources";
import type { CalendarApi } from "@/features/calendar/server/google-sync-core";
const source = { tagName: "입학 상담", calendarId: "admission" };
const cal = { events: { list: mock.list } } as unknown as CalendarApi;
const event = { id: "sample", summary: "입테 가상학생 010-0000-0001", start: { date: "2026-01-04" }, description: "never returned" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_CALENDAR_TENANT_ID", "academy");
  vi.stubEnv("GOOGLE_CALENDAR_IDS", "입학 상담|admission;신입생/시범수업|trial;운영팀 중요일정|ops");
  vi.stubEnv("GOOGLE_VISITOR_HISTORY_CALENDAR_IDS", "");
  mock.api.mockReturnValue({ ok: true, cal });
  mock.list.mockResolvedValue({ data: { items: [event] } });
});
it("uses exclusive next month, including December", () => {
  expect(monthBounds("2025-12")).toEqual({ timeMin: "2025-12-01T00:00:00+09:00", timeMax: "2026-01-01T00:00:00+09:00" });
});
it("reads only admission calendars bound to the signed-in tenant", async () => {
  expect(visitorSources("other")).toEqual([]);
  vi.stubEnv("GOOGLE_VISITOR_HISTORY_CALENDAR_IDS", "admission;trial;ops;unconfigured");
  expect(visitorSources("academy")).toEqual([source]);
  await fetchVisitorMonth("academy", "2026-01");
  expect(mock.list).toHaveBeenCalledTimes(1);
  expect(mock.list.mock.calls[0][0]).toMatchObject({ calendarId: "admission", showDeleted: true, singleEvents: true });
});
it("follows tokens even after empty pages and does not request descriptions/contacts or free text search", async () => {
  mock.list.mockResolvedValueOnce({ data: { items: [], nextPageToken: "next" } }).mockResolvedValueOnce({ data: { items: [event] } });
  const result = await readSource(cal, source, "2026-01");
  expect(result.complete).toBe(true); expect(result.records).toHaveLength(1);
  expect(mock.list.mock.calls[1][0].pageToken).toBe("next");
  const args = mock.list.mock.calls[0][0];
  expect(args).not.toHaveProperty("q");
  expect(args.fields).not.toMatch(/description|location|attendees/);
  expect(JSON.stringify(result)).not.toMatch(/010-0000|never returned|admission:/);
});
it("bounds pagination, exposes partial records and does not silently truncate", async () => {
  mock.list.mockImplementation(({ pageToken }) => Promise.resolve({ data: { items: [], nextPageToken: String(Number(pageToken ?? 0) + 1) } }));
  const result = await readSource(cal, source, "2026-01");
  expect(mock.list).toHaveBeenCalledTimes(12); expect(result.complete).toBe(false);
});
it("stops repeated pagination tokens", async () => {
  mock.list.mockResolvedValue({ data: { items: [], nextPageToken: "same" } });
  expect((await readSource(cal, source, "2026-01")).complete).toBe(false);
  expect(mock.list).toHaveBeenCalledTimes(2);
});
it("reports failure separately from empty successful months and strips private API errors", async () => {
  mock.list.mockRejectedValue(new Error("private credentials"));
  const failed = await fetchVisitorMonth("academy", "2026-01");
  expect(failed.complete).toBe(false); expect(JSON.stringify(failed)).not.toContain("private credentials");
  mock.list.mockResolvedValue({ data: { items: [] } });
  expect((await fetchVisitorMonth("academy", "2026-01")).complete).toBe(true);
  expect((await fetchVisitorMonth("other", "2026-01")).complete).toBe(false);
});
it("does not claim tombstones without titles/dates were classified", async () => {
  mock.list.mockResolvedValue({ data: { items: [{ id: "gone", status: "cancelled" }, { id: "private", start: event.start }] } });
  const result = await readSource(cal, source, "2026-01");
  expect(result.unclassified).toBe(2); expect(result.records).toHaveLength(0);
});
it("deduplicates duplicate source configuration", () => {
  vi.stubEnv("GOOGLE_CALENDAR_IDS", "입학 상담|admission;입학상담_NEW|admission");
  expect(visitorSources("academy")).toHaveLength(1);
});
it("keeps more than 1000 matching records across pages", async () => {
  mock.list.mockImplementation(({ pageToken }) => {
    const page = Number(pageToken ?? 0);
    return Promise.resolve({ data: {
      items: Array.from({ length: page === 4 ? 1 : 250 }, (_, i) => ({ ...event, id: `sample-${page}-${i}` })),
      nextPageToken: page < 4 ? String(page + 1) : undefined,
    } });
  });
  const result = await readSource(cal, source, "2026-01");
  expect(result.complete).toBe(true); expect(result.records).toHaveLength(1001);
});
it("does not assign an overlapping event from the previous month to this month", async () => {
  mock.list.mockResolvedValue({ data: { items: [{ ...event, start: { date: "2025-12-31" } }] } });
  const result = await readSource(cal, source, "2026-01");
  expect(result.records).toHaveLength(0); expect(result.unclassified).toBe(0);
});
