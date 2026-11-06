import "server-only";
import { notificationInbox } from "@/features/notifications/server/inbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { groupTaskState, taskState, type NotificationTaskBadge, type StaffTaskSummary } from "../kinds";
import { getStaffTaskViewer } from "./gate";
import { countOpenTasks, taskBadgesFor } from "./queries";

/**
 * 벨이 붙이는 할 일 정보(0377a). 60초 폴링마다 도니 목록 조회와 나란히(B4) · 집계는 DB에서.
 * 🔴 실패하면 null / 빈 표(벨 목록은 그대로) — 이 기능 때문에 전원의 벨이 비면 안 된다([[#95]] 계열).
 */
export async function myTaskSummary(): Promise<StaffTaskSummary | null> {
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return null;
    const mine = (await countOpenTasks(viewer.user.tenantId, viewer.user.id)).get(viewer.user.id) ?? { open: 0, late: 0 };
    return { open: mine.open, late: mine.late, canMonitor: viewer.canMonitor };
  } catch (error) {
    reportError(error, { scope: "notifications.task-summary" });
    return null;
  }
}

/** 목록 알림 줄 → 그 알림이 알린 할 일의 지금 상태(내가 맡은 할 일만). 묶음 알림은 연결표(0378a)로 여러 건을 모은다. */
export async function notificationTaskBadges(notificationIds: readonly string[]): Promise<Map<string, NotificationTaskBadge>> {
  const badges = new Map<string, NotificationTaskBadge>();
  if (!notificationIds.length) return badges;
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return badges;
    const tenantId = viewer.user.tenantId;
    // 알림 → 할 일: 단건은 받은함 알림(받는 사람 · 지점 명시 — 평소 본인 · '다른 강사 뷰'는 그 강사, inbox.ts)의 task_id,
    // 묶음은 연결표(관리 키 — 넘긴 id가 이미 받은함 목록이다).
    const inbox = await notificationInbox();
    if (!inbox) return badges;
    const [single, grouped] = await Promise.all([
      (async () => {
        const { data, error } = await inbox.db
          .from("notifications").select("id, task_id").eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId)
          .in("id", [...notificationIds]).not("task_id", "is", null);
        if (error) throw new Error(`알림 할 일 연결: ${error.message}`);
        return (data ?? []) as { id: string; task_id: string }[];
      })(),
      groupedLinks(tenantId, notificationIds),
    ]);
    const byNotification = new Map<string, string[]>();
    for (const p of [...single.map((r) => ({ notification_id: r.id, task_id: r.task_id })), ...grouped]) {
      const list = byNotification.get(p.notification_id) ?? [];
      if (!list.includes(p.task_id)) list.push(p.task_id);
      byNotification.set(p.notification_id, list);
    }
    if (!byNotification.size) return badges;
    const states = await taskBadgesFor(tenantId, viewer.user.id, [...byNotification.values()].flat());
    for (const [notificationId, taskIds] of byNotification) {
      const mine = taskIds.flatMap((id) => {
        const s = states.get(id);
        return s ? [{ id, state: taskState(s.status, s.dueAt) }] : [];
      });
      if (!mine.length) continue;
      if (mine.length === 1) { badges.set(notificationId, mine[0]); continue; }
      const openOnes = mine.filter((m) => m.state === "open" || m.state === "late");
      badges.set(notificationId, {
        id: (openOnes[0] ?? mine[0]).id,
        state: groupTaskState(mine.map((m) => m.state)),
        total: mine.length,
        remaining: openOnes.length,
      });
    }
  } catch (error) {
    reportError(error, { scope: "notifications.task-badges" });
  }
  return badges;
}

/** 묶음 알림 연결(0378a) — 표가 아직 없거나 실패하면 빈 목록(단건 칩은 그대로 붙는다). */
async function groupedLinks(tenantId: string, notificationIds: readonly string[]): Promise<{ notification_id: string; task_id: string }[]> {
  // 알림은 100건 이하지만 묶음 하나가 수백 건을 이을 수 있다 — 연결 줄은 페이지로(1,000행 침묵 절단 방지, B2).
  try {
    const admin = createAdminClient();
    return await fetchAllPagedInChunks<{ notification_id: string; task_id: string }>([...notificationIds], (chunk, from, to) => admin
      .from("staff_task_notifications").select("notification_id, task_id")
      .eq("tenant_id", tenantId).in("notification_id", chunk).order("task_id").order("notification_id").range(from, to));
  } catch (error) {
    reportError(error, { scope: "notifications.task-badges.grouped" });
    return [];
  }
}
