import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_BRIEFING_ENABLED } from "./briefing-status";
import { GET } from "@/app/api/cron/daily-briefing/route";
import { generateDailyBriefing, getDailyBriefing } from "./server/briefing";
import { regenerateDailyBriefing } from "./server/actions";

const blocked = vi.hoisted(() => ({ database: vi.fn(), ai: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: blocked.database }));
vi.mock("@/lib/ai/generate", () => ({ generateJSON: blocked.ai }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: blocked.auth }));

afterEach(() => vi.unstubAllEnvs());
describe("일일 브리핑 중단", () => {
  it("직접 생성·재생성·조회해도 DB와 AI API에 접근하지 않는다", async () => {
    expect(await generateDailyBriefing("tenant")).toMatchObject({ ok: false });
    expect(await regenerateDailyBriefing()).toHaveProperty("error");
    expect(await getDailyBriefing("tenant", "2026-09-30")).toBeNull();
    expect(blocked.database).not.toHaveBeenCalled();
    expect(blocked.ai).not.toHaveBeenCalled();
    expect(blocked.auth).not.toHaveBeenCalled();
  });
  it("기능이 꺼져 있고 과거 cron 주소는 인증 뒤에도 410을 반환한다", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect(DAILY_BRIEFING_ENABLED).toBe(false);
    expect((await GET(new Request("http://localhost/api/cron/daily-briefing"))).status).toBe(401);
    const response = await GET(new Request("http://localhost/api/cron/daily-briefing", { headers: { authorization: "Bearer test-secret" } }));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ disabled: true });
  });
  it("예약 작업은 일반 알림 점검만 호출한다", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    const schedule = JSON.parse(read("vercel.json"));
    expect(schedule.crons.some((entry: { path: string }) => entry.path === "/api/cron/daily-briefing")).toBe(false);
    expect(schedule.crons.some((entry: { path: string }) => entry.path === "/api/cron/notification-maintenance")).toBe(true);
    const maintenance = read("src/app/api/cron/notification-maintenance/route.ts");
    expect(maintenance).not.toContain("generateDailyBriefing");
    for (const fn of ["detectAndNotifyEvents", "sweepFailedReportNotifications", "pruneNotificationData"]) expect(maintenance).toContain(`await ${fn}(`);
  });
});
