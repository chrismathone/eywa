import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { NOTIFICATION_LIST_LIMIT, NOTIFICATION_LIST_MAX, type NotificationItem } from "../types";
import { presentNotification } from "../presentation";
import { myTaskSummary, notificationTaskBadges } from "@/features/staff-tasks/server/bell";
import type { StaffTaskSummary } from "@/features/staff-tasks/kinds";

/** 클라가 보낸 목록 크기를 믿지 않고 20~100 사이로 맞춘다. */
export function clampNotificationLimit(limit: unknown): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : NOTIFICATION_LIST_LIMIT;
  return Math.min(NOTIFICATION_LIST_MAX, Math.max(NOTIFICATION_LIST_LIMIT, n));
}

/** 벨 목록 뷰 — active=받은함(비보관, 기본) / archived=보관함(0125a). */
export type NotificationView = "active" | "archived";

/**
 * 내 알림 목록(최신순) + 안 읽은 수 — RLS(recipient_id=auth.uid())로 본인 것만.
 * unread 배지는 **비보관만** 센다(보관=치웠다는 의사표시인데 배지가 계속 울리면 보관이 무의미).
 */
export async function getMyNotifications(
  view: NotificationView = "active",
  limit: number = NOTIFICATION_LIST_LIMIT,
): Promise<{ unread: number; items: NotificationItem[]; tasks?: StaffTaskSummary }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  // 운영 콘솔의 '지점 보기'(읽기 전용) 중에는 벨을 비운다 — 알림은 지점이 아니라 **받는 사람**으로 걸러지는 표라
  // (`recipient_id = auth.uid()`), 그대로 읽으면 운영자 본인이 자기 지점에서 받은 알림이 보는 지점 화면에 뜬다.
  // 보기 쿠키가 남아 있는데 보기가 아닌 요청(끝났다 · 확인하지 못했다)도 같다 — 그 브라우저에는 보기 띠를 단 탭이 남아 있을 수 있다.
  if (user.tenantView || (await isTenantViewWriteBlocked())) return { unread: 0, items: [] };
  const supabase = await createClient();
  // 내 할 일 수(0377a)는 목록과 상관없다 — 먼저 띄워 두고 함께 기다린다(B4).
  const summaryPromise = myTaskSummary();

  const list = supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at")
    .neq("type", "daily_briefing") // 폐지된 브리핑 알림은 목록 상한을 적용하기 전에 제외한다.
    .order("created_at", { ascending: false })
    .limit(clampNotificationLimit(limit));

  // 목록(최근 20)과 안읽음 카운트는 독립 → 병렬(B4). 카운트는 head:true로 행 미수신.
  const [{ data }, { count }] = await Promise.all([
    view === "archived" ? list.not("archived_at", "is", null) : list.is("archived_at", null),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .neq("type", "daily_briefing") // 보이지 않는 알림 때문에 배지가 남지 않도록 같은 기준 사용.
      .is("read_at", null)
      .is("archived_at", null),
  ]);

  const items: NotificationItem[] = (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read_at !== null,
    createdAt: n.created_at,
  }));
  // 할 일(0377a) — 이 알림들의 처리 상태 · 내 할 일 수. 실패해도 목록은 그대로 낸다(벨이 비면 안 된다).
  const [badges, summary] = await Promise.all([notificationTaskBadges(items.map((i) => i.id)), summaryPromise]);
  return {
    unread: count ?? 0,
    items: items.map((i) => {
      const task = badges.get(i.id);
      return presentNotification(task ? { ...i, task } : i);
    }),
    ...(summary ? { tasks: summary } : {}),
  };
}
