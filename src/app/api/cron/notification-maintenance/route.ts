import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { detectAndNotifyEvents } from "@/features/notifications/server/events";
import { pruneNotificationData } from "@/features/notifications/server/prune";
import { sweepFailedReportNotifications } from "@/features/notifications/server/failed-notify-sweep";
import { checkProtectedAccountIntegrity } from "@/features/super-admin/server/protected-integrity";
import { reconcileVideoHomework } from "@/features/video-homework/server/reconcile-outcomes";
import { sendStaffTaskDigest } from "@/features/staff-tasks/server/digest";

/** Daily notification checks and cleanup. AI briefing generation was retired on 2026-09-30. */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // 보호 계정(super_admins 명단) 매일 점검 — 3선(원장 2026-09-30). 다른 단계 실패로 건너뛰지 않게 **맨 앞**에서 돈다.
  let protectedCheck: { members: number; issues: number; triggersChecked: boolean } | string;
  try {
    // 맨 앞이라 멈추면 뒤 단계가 통째로 굶는다(supabase-js fetch엔 타임아웃이 없다) — 20초에서 끊고 넘어간다.
    const r = await Promise.race([
      checkProtectedAccountIntegrity(admin),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("보호 계정 점검 시간 초과(20초)")), 20_000),
      ),
    ]);
    protectedCheck = { members: r.members, issues: r.issues.length, triggersChecked: r.triggersChecked };
  } catch (e) {
    reportError(e, { scope: "security.protected-integrity" });
    protectedCheck = `실패: ${e instanceof Error ? e.message : String(e)}`;
  }

  const { data: masters, error } = await admin
    .from("users")
    .select("tenant_id")
    .eq("system_role", "master")
    .eq("status", "active");
  if (error) {
    reportError(error, { scope: "cron.notification-maintenance", step: "list-tenants" });
    return NextResponse.json({ error: `대상 테넌트 조회 실패: ${error.message}`, protectedCheck }, { status: 500 });
  }

  const tenantIds = [...new Set((masters ?? []).map((row) => row.tenant_id as string))];
  const events: Record<string, string> = {};
  const sweeps: Record<string, string> = {}; // 발송 실패 알림 유실 보정 결과(테넌트별)
  const videos: Record<string, string> = {};
  const taskDigests: Record<string, string> = {}; // 늦은 할 일 아침 요약(0377a)
  for (const tenantId of tenantIds) {
    try {
      const result = await reconcileVideoHomework(tenantId, { notifyUnmatched: true, scheduled: true });
      videos[tenantId] = `확인 ${result.checked}·갱신 ${result.updated}·알림 ${result.notifications}`;
    } catch (e) {
      reportError(e, { scope: "cron.notification-maintenance.video-homework", tenantId });
      videos[tenantId] = "영상 과제 확인 실패";
    }
    // 일반 이벤트 알림은 일일 AI 브리핑 중단과 독립적으로 유지한다.
    try {
      const detected = await detectAndNotifyEvents(tenantId);
      events[tenantId] = `결석 ${detected.absence}·후속 ${detected.followup}·콜상담 후속 ${detected.enrollmentFollowup}·성적 ${detected.gradeDrop}·미수 ${detected.outstanding}·미발송 ${detected.unsentReport}·미저장 ${detected.unsentDraft}·진도이상 ${detected.progressAnomaly}·재발송마감 ${detected.sendDeadline}`;
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
    // 늦은 할 일 요약 — 위 보정이 메운 할 일까지 본 뒤(순서 의존). 실패해도 다른 단계와 무관.
    try {
      const late = await sendStaffTaskDigest(admin, tenantId);
      taskDigests[tenantId] = `늦은 할 일 ${late}`;
    } catch (e) {
      reportError(e, { scope: "cron.notification-maintenance.staff-task-digest", tenantId });
      taskDigests[tenantId] = `실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 오래된 dedup 이벤트·읽은 알림 정리 · 30일 넘게 안 읽은 알림 보관 — 전 테넌트 공통 1회.
  let pruned: { events: number; notifications: number; archived: number } | string;
  try {
    pruned = await pruneNotificationData();
  } catch (e) {
    reportError(e, { scope: "cron.notification-maintenance.prune" });
    pruned = `실패: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({ ok: true, tenants: tenantIds.length, events, sweeps, videos, taskDigests, pruned, protectedCheck });
}
