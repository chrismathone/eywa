import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
vi.mock("@/features/calendar/server/google-sync-core", () => ({ calendarApi: () => ({ok:true,cal:{events:{list}}}) }));
vi.mock("next/cache", () => ({unstable_cache: (fn: unknown) => fn}));
import { fetchGoogleHistory, historySources } from "./google";
beforeEach(() => {
  vi.stubEnv("GOOGLE_CALENDAR_TENANT_ID","sample-tenant");
  vi.stubEnv("GOOGLE_CALENDAR_IDS","입학 상담|counsel\n신입생/시범수업|trial\n개인 일정|private");
  vi.stubEnv("GOOGLE_ENROLLMENT_HISTORY_CALENDAR_IDS","");
  list.mockReset(); list.mockResolvedValue({data:{items:[]}});
});
afterEach(() => vi.unstubAllEnvs());
describe("read-only calendar history", () => {
  it("denies a different academy before any API request", async () => {
    expect(historySources("other")).toEqual([]);
    expect((await fetchGoogleHistory("other","테스트학생","2026-10-19")).complete).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
  it("pages the historical window and excludes descriptions from Google response", async () => {
    list.mockImplementation(async ({calendarId,pageToken}) => ({data:calendarId==="counsel"&&!pageToken
      ? {items:[],nextPageToken:"page-two"} : {items:[]}}));
    const r = await fetchGoogleHistory("sample-tenant","테스트학생","2026-10-19");
    expect(r.complete).toBe(true); expect(list).toHaveBeenCalledTimes(3);
    for (const [args] of list.mock.calls) {
      expect(args.timeMin).toBe("2000-01-01T00:00:00+09:00");
      expect(args.fields).not.toContain("description"); expect(args.calendarId).not.toBe("private");
    }
  });
  it("reports partial failure instead of a misleading empty history", async () => {
    list.mockRejectedValueOnce(new Error("remote private detail"));
    const r = await fetchGoogleHistory("sample-tenant","테스트학생","2026-10-19");
    expect(r.complete).toBe(false); expect(r.message).toContain("일부");
    expect(JSON.stringify(r)).not.toContain("remote private detail");
  });
  it("allows explicit configuration only inside already shared sources", () => {
    vi.stubEnv("GOOGLE_ENROLLMENT_HISTORY_CALENDAR_IDS","unknown;counsel");
    expect(historySources("sample-tenant").map(s=>s.calendarId)).toEqual(["counsel"]);
  });
});
