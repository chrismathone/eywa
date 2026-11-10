import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { addDays, kstToday } from "@/lib/date-kst";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { escalateAndSnapshot, openPastCycles, syncDailyDuties } from "@/features/duties/server/sync";
import { syncMonthlyDuties } from "@/features/duties/server/monthly-sync";
import { claimDutySync, finishDutySync, type DutyClaim } from "@/features/duties/server/live-sync";
import { syncDays } from "@/features/duties/model/sync-window";

/**
 * 의무 장부 30분 맞춤(s2_0043) — 지점마다 **오늘**의 일간 의무를 만들고(시간표·명단 · AI 없음) 원 표의 사실로 닫는다.
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
  // 월간·건별(상담 · 신규생 콜)은 한 시간에 한 번(:05 실행)이면 충분하다 — 상담 의무 판정이 반·수강·시간표를 다 읽는다.
  const monthlyTurn = new Date().getUTCMinutes() < 30 || req.headers.get("x-duties-monthly") === "1";
  const yesterday = addDays(today, -1);
  let drafts = 0, taskOpened = 0, taskClosed = 0, failed = 0, skipped = 0;
  const synced: Record<string, number> = {};
  for (const tenantId of new Set(users.map((u) => u.tenant_id))) {
    // 화면의 맞춤(`flushDuties`)과 같은 잠금을 쓴다(s2_0051). 화면이 맞추는 중이면 잠깐 기다렸다 다시 잡는다(화면의 맞춤은 몇 초) — 그래도 못 잡으면 이번 차례는 건너뛴다.
    // 트리거가 적어 둔 날도 함께 맞춘다(지난 날의 정정 · 오늘과 최근 7일만).
    let claim: DutyClaim | null = null;
    try {
      let got = await claimDutySync(tenantId, true);
      for (let i = 0; i < 3 && !got.locked && !got.missing; i++) { await new Promise((r) => setTimeout(r, 4000)); got = await claimDutySync(tenantId, true); }
      if (!got.locked && !got.missing) { synced[tenantId] = 0; skipped++; continue; }
      if (got.locked) claim = got;
      const settings = await getTenantSettingsByTenantId(tenantId, { failOnReadError: true });
      const days = syncDays(got.days, today, [...(await openPastCycles(tenantId)), ...(kstHour < 3 ? [yesterday] : []), today]);
      for (const day of days) drafts += (await syncDailyDuties(tenantId, day, settings)).drafts;
      if (monthlyTurn || got.monthly) { const m = await syncMonthlyDuties(tenantId, today, settings); drafts += m.counsel + m.exam + m.newcomer; }
      const r = await escalateAndSnapshot(tenantId, days);
      taskOpened += r.taskOpened;
      taskClosed += r.taskClosed;
      synced[tenantId] = days.length;
      if (claim) { await finishDutySync(tenantId, claim, true, true); claim = null; }
      // s2_0051이 아직 없는 곳 — 종전대로 기준 시각만 적는다(관리자 화면의 '기준 시각').
      else {
        const stamp = await db.from("duty_settings").upsert({ tenant_id: tenantId, last_sync_at: new Date().toISOString() }, { onConflict: "tenant_id" });
        if (stamp.error && stamp.error.code !== "42P01" && stamp.error.code !== "PGRST205") throw new Error(`장부 맞춤 기준 시각: ${stamp.error.message}`);
      }
    } catch (error) {
      if (claim) await finishDutySync(tenantId, claim, false).catch(() => undefined);
      failed++;
      reportError(error, { scope: "cron.duties", tenantId });
    }
  }
  return NextResponse.json({ ok: failed === 0, today, synced, drafts, taskOpened, taskClosed, failed, skipped }, { status: failed ? 500 : 200 });
}
