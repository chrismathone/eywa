import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { generateDailyBriefing } from "@/features/dashboard/server/briefing";
import { detectAndNotifyEvents } from "@/features/notifications/server/events";

/**
 * 운영실 일일 AI 브리핑 cron (매일 07:00 KST = 22:00 UTC, 원장 승인 2026-07-16 — 새벽 동기화
 * 3종(03:00~04:00 KST) 이후 최신 데이터로 생성). 테넌트당 LLM ≤1콜/일(신호 0건 날은 스킵 —
 * shouldGenerateNarrative), 결과는 daily_briefings에 upsert(tenant×date 멱등, 재실행 안전).
 *
 * 대상 테넌트 = **활성 master가 1명 이상인 테넌트만**(수신자 없는 데모·휴면 테넌트에 매일
 * LLM 비용을 태우지 않는다). sheets-sync 선례: 테넌트별 try/catch로 부분 실패 허용 + 관측성 응답.
 * ⚠️ Vercel Hobby는 cron 슬롯 제한이 있어(문서상 2개, 현재 3개 등록) 4번째 배포가 거부되면
 * 외부 스케줄러(cron-job.org 등)가 Bearer CRON_SECRET로 이 라우트를 호출하는 대안을 쓴다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120; // 이 프로젝트에서 배포 검증된 상한(sheets-sync 선례) — 테넌트당 LLM 1콜 + retention

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: masters, error } = await admin
    .from("users")
    .select("tenant_id")
    .eq("system_role", "master")
    .eq("status", "active");
  if (error) {
    reportError(error, { scope: "cron.daily-briefing", step: "list-tenants" });
    return NextResponse.json({ error: `대상 테넌트 조회 실패: ${error.message}` }, { status: 500 });
  }

  const tenantIds = [...new Set((masters ?? []).map((row) => row.tenant_id as string))];
  const results: Record<string, string> = {};
  const events: Record<string, string> = {};
  for (const tenantId of tenantIds) {
    try {
      const result = await generateDailyBriefing(tenantId, { notifyOnFirstGeneration: true });
      results[tenantId] = result.ok ? "ok" : `실패: ${result.error}`;
    } catch (e) {
      // generateDailyBriefing이 자체 실패 처리를 하지만, 그 밖의 예외도 다음 테넌트를 막지 않는다.
      reportError(e, { scope: "cron.daily-briefing", tenantId });
      results[tenantId] = `실패: ${e instanceof Error ? e.message : String(e)}`;
    }
    // Phase 3 이벤트 감지 — 브리핑과 **독립된 try/catch**(브리핑 실패해도 이벤트 알림은 돌아야 함).
    try {
      const detected = await detectAndNotifyEvents(tenantId);
      events[tenantId] = `결석 ${detected.absence}·후속 ${detected.followup}`;
    } catch (e) {
      reportError(e, { scope: "cron.daily-briefing.events", tenantId });
      events[tenantId] = `실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({ ok: true, tenants: tenantIds.length, results, events });
}
