import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATCH_UP_FLOOR_MS, catchUpSince, isForceFull, isWeeklyFullDay, planCalendarCron } from "./cron-plan";

// 2026-09-30(수) 04:00 KST = 2026-09-29 19:00 UTC
const NOW = Date.parse("2026-09-29T19:00:00Z");
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const healthy = { last_synced_at: iso(NOW - 3 * H), channel_id: "ch-1", channel_expires_at: iso(NOW + 5 * 24 * H) };
const plan = (o: Partial<Parameters<typeof planCalendarCron>[0]> = {}) =>
  planCalendarCron({ state: healthy, channelFailed: false, forceFull: false, weekly: false, now: NOW, ...o });

describe("새벽 크론 — 캘린더마다 증분이냐 전체냐", () => {
  it("상태가 멀쩡하면 증분(가볍게)", () => {
    expect(plan()).toEqual({ mode: "incremental", reason: "incremental" });
  });
  it("?full=1 · 주간 안전망은 무조건 전체", () => {
    expect(plan({ forceFull: true })).toEqual({ mode: "full", reason: "manual" });
    expect(plan({ weekly: true })).toEqual({ mode: "full", reason: "weekly" });
  });
  it("상태 줄이 없거나 시작점이 없으면 전체", () => {
    expect(plan({ state: null }).reason).toBe("no_state");
    expect(plan({ state: { ...healthy, last_synced_at: null } }).reason).toBe("never_synced");
    expect(plan({ state: { ...healthy, last_synced_at: "엉망" } }).reason).toBe("never_synced");
  });
  it("시작점이 48시간보다 오래되면 전체 · 48시간 이내는 증분", () => {
    expect(plan({ state: { ...healthy, last_synced_at: iso(NOW - 49 * H) } }).reason).toBe("stale");
    expect(plan({ state: { ...healthy, last_synced_at: iso(NOW - 47 * H) } }).mode).toBe("incremental");
  });
  it("채널 열기 실패 · 채널이 없었음 · 이미 만료됐음 → 전체(그동안 알림을 못 받았다)", () => {
    expect(plan({ channelFailed: true }).reason).toBe("channel_failed");
    expect(plan({ state: { ...healthy, channel_id: null } }).reason).toBe("channel_missing");
    expect(plan({ state: { ...healthy, channel_expires_at: iso(NOW - H) } }).reason).toBe("channel_expired");
    expect(plan({ state: { ...healthy, channel_expires_at: null } }).reason).toBe("channel_expired");
  });
  it("곧 만료될 채널(갱신 대상)은 아직 살아 있으니 증분", () => {
    expect(plan({ state: { ...healthy, channel_expires_at: iso(NOW + 10 * H) } }).mode).toBe("incremental");
  });
});

describe("새벽 크론 — 보조 판정", () => {
  it("주간 전체 = KST 일요일(토요일 19:00 UTC 크론)", () => {
    expect(isWeeklyFullDay(Date.parse("2026-10-03T19:00:00Z"))).toBe(true); // 10/4(일) 04:00 KST
    expect(isWeeklyFullDay(Date.parse("2026-10-04T19:00:00Z"))).toBe(false); // 10/5(월) 04:00 KST
    expect(isWeeklyFullDay(NOW)).toBe(false);
  });
  it("증분 시작점은 최소 25시간 전부터(더 오래된 시작점은 그대로)", () => {
    expect(catchUpSince(iso(NOW - H), NOW)).toBe(iso(NOW - CATCH_UP_FLOOR_MS));
    expect(catchUpSince(iso(NOW - 40 * H), NOW)).toBe(iso(NOW - 40 * H));
    expect(catchUpSince(null, NOW)).toBe(iso(NOW - CATCH_UP_FLOOR_MS));
  });
  it("?full=1만 강제 전체", () => {
    expect(isForceFull("https://x/api/cron/google-calendar-import?full=1")).toBe(true);
    expect(isForceFull("https://x/api/cron/google-calendar-import")).toBe(false);
    expect(isForceFull("https://x/api/cron/google-calendar-import?full=true")).toBe(false);
  });
});

describe("새벽 크론 — 배선 가드", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
  it("🔴 vercel.json에 이 크론은 하루 한 번(04:00 KST)만", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const mine = vercel.crons.filter((c) => c.path === "/api/cron/google-calendar-import");
    expect(mine).toEqual([{ path: "/api/cron/google-calendar-import", schedule: "0 19 * * *" }]);
  });
  it("🔴 새벽 증분은 웹훅과 같은 함수(같은 잠금) · 웹훅은 빈 결과에 시작점을 옮기지 않는다", () => {
    const cron = read("src/features/calendar/server/google-cron.ts");
    expect(cron).toMatch(/runGoogleCalendarIncremental\(/);
    expect(cron).toMatch(/planCalendarCron\(/);
    expect(cron).toMatch(/ensureCalendarChannels\(/);
    expect(read("src/app/api/cron/google-calendar-import/route.ts")).toMatch(/runCalendarCronLight\(/);
    expect(read("src/app/api/calendar/google-push/route.ts")).not.toMatch(/advanceOnEmpty/);
    // 🔴 dirty로 이어진 둘째 회차부터는 웹훅 규칙(0건이면 시작점 유지) — 크론 첫 회차만 빈 결과에 전진.
    expect(read("src/features/calendar/server/google-incremental.ts")).toMatch(/advanceOnEmpty: round === 0 && opts\.advanceOnEmpty === true/);
  });
});
