import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { detectAndNotifyEvents } from "@/features/notifications/server/events";
import { pruneNotificationData } from "@/features/notifications/server/prune";
import { sweepFailedReportNotifications } from "@/features/notifications/server/failed-notify-sweep";

/** Daily notification checks and cleanup. AI briefing generation was retired on 2026-09-30. */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: masters, error } = await admin
    .from("users")
    .select("tenant_id")
    .eq("system_role", "master")
    .eq("status", "active");
  if (error) {
    reportError(error, { scope: "cron.notification-maintenance", step: "list-tenants" });
    return NextResponse.json({ error: `대상 테넌트 조회 실패: ${error.message}` }, { status: 500 });
  }

  const tenantIds = [...new Set((masters ?? []).map((row) => row.tenant_id as string))];
  const events: Record<string, string> = {};
  const sweeps: Record<string, string> = {}; // 발송 실패 알림 유실 보정 결과(테넌트별)
  for (const tenantId of tenantIds) {
    // 일반 이벤트 알림은 일일 AI 브리핑 중단과 독립적으로 유지한다.
    try {
      const detected = await detectAndNotifyEvents(tenantId);
      events[tenantId] = `결석 ${detected.absence}·후속 ${detected.followup}·성적 ${detected.gradeDrop}·미수 ${detected.outstanding}·미발송 ${detected.unsentReport}·진도이상 ${detected.progressAnomaly}·재발송마감 ${detected.sendDeadline}`;
    } catch (e) {
      reportError(e, { scope: "cron.notification-maintenance.events", tenantId });
      events[tenantId] = `실패: ${e instanceof Error ? e.message : String(e)}`;
    }
    // 발송 실패 알림 유실 보정 — 0143a 트리거가 예외를 삼켜 알림이 사라진 건을 메운다(failed-notify-sweep.ts).
    // 이벤트 감지가 실패해도 발송 실패 알림 보정은 실행한다.
    try {
      const swept = await sweepFailedReportNotifications(admin, tenantId);
      sweeps[tenantId] = `확인 ${swept.checked}·보정 ${swept.created}`;
    } catch (e) {
      reportError(e, { scope: "cron.notification-maintenance.failed-notify-sweep", tenantId });
      sweeps[tenantId] = `실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 오래된 dedup 이벤트·읽은 알림 정리 — 전 테넌트 공통 1회.
  let pruned: { events: number; notifications: number } | string;
  try {
    pruned = await pruneNotificationData();
  } catch (e) {
    reportError(e, { scope: "cron.notification-maintenance.prune" });
    pruned = `실패: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({ ok: true, tenants: tenantIds.length, events, sweeps, pruned });
}
