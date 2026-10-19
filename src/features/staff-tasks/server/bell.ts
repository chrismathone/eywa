import "server-only";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report-error";
import { taskState, type NotificationTaskBadge, type StaffTaskSummary } from "../kinds";
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

/** 목록 알림 줄 → 그 알림이 알린 할 일의 지금 상태(내가 맡은 할 일만). */
export async function notificationTaskBadges(notificationIds: readonly string[]): Promise<Map<string, NotificationTaskBadge>> {
  const badges = new Map<string, NotificationTaskBadge>();
  if (!notificationIds.length) return badges;
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return badges;
    // 알림 → 할 일 연결은 내 알림 표에서(RLS = 받는 사람 본인). 목록 크기(≤100)라 한 번에.
    const { data, error } = await (await createClient())
      .from("notifications").select("id, task_id").in("id", [...notificationIds]).not("task_id", "is", null);
    if (error) throw new Error(`알림 할 일 연결: ${error.message}`);
    const pairs = (data ?? []) as { id: string; task_id: string }[];
    if (!pairs.length) return badges;
    const states = await taskBadgesFor(viewer.user.tenantId, viewer.user.id, pairs.map((p) => p.task_id));
    for (const p of pairs) {
      const s = states.get(p.task_id);
      if (s) badges.set(p.id, { id: p.task_id, state: taskState(s.status, s.dueAt) });
    }
  } catch (error) {
    reportError(error, { scope: "notifications.task-badges" });
  }
  return badges;
}
