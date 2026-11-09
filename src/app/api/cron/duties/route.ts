import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { addDays, kstToday } from "@/lib/date-kst";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { escalateAndSnapshot, openPastCycles, syncDailyDuties } from "@/features/duties/server/sync";

/**
 * 의무 장부 30분 맞춤(s2_0039) — 지점마다 **오늘**의 일간 의무를 만들고(시간표·명단 · AI 없음) 원 표의 사실로 닫는다.
 * 어제는 새벽 3시 전까지 함께, 그 뒤로도 **기한이 지났는데 열린 의무가 남은 지난 날**(최근 7일)은 다시 맞춘다 — 다음 날 아침에 보낸 보고서 ·
 * 늦게 찍은 출결이 닫히게(안 그러면 늦음 할 일이 영영 안 닫힌다). 그 뒤 늦음 사다리(할 일)와 일별 스냅숏. 한 지점이 실패해도 나머지는 돈다 · 실패는 500.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const users = await fetchAllPaged<{ tenant_id: string }>((from, to) => db.from("users").select("tenant_id")
    .eq("system_role", "master").eq("status", "active").order("id").range(from, to));
  const today = kstToday();
  // hourCycle h23 — `hour12:false`만 주면 ICU 판에 따라 자정이 "24"로 나온다(check-time.ts와 같은 주의).
  const kstHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const yesterday = addDays(today, -1);
  let drafts = 0, taskOpened = 0, taskClosed = 0, failed = 0;
  const synced: Record<string, number> = {};
  for (const tenantId of new Set(users.map((u) => u.tenant_id))) {
    try {
      const settings = await getTenantSettingsByTenantId(tenantId, { failOnReadError: true });
      const days = [...new Set([...(await openPastCycles(tenantId)), ...(kstHour < 3 ? [yesterday] : []), today])].sort();
      for (const day of days) drafts += (await syncDailyDuties(tenantId, day, settings)).drafts;
      const r = await escalateAndSnapshot(tenantId, days);
      taskOpened += r.taskOpened;
      taskClosed += r.taskClosed;
      synced[tenantId] = days.length;
    } catch (error) {
      failed++;
      reportError(error, { scope: "cron.duties", tenantId });
    }
  }
  return NextResponse.json({ ok: failed === 0, today, synced, drafts, taskOpened, taskClosed, failed }, { status: failed ? 500 : 200 });
}
