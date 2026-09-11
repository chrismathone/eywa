import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { NotificationItem } from "../types";
import { presentNotification } from "../presentation";

const LIST_LIMIT = 20;

/** 벨 목록 뷰 — active=받은함(비보관, 기본) / archived=보관함(0125a). */
export type NotificationView = "active" | "archived";

/**
 * 내 알림 목록(최신순) + 안 읽은 수 — RLS(recipient_id=auth.uid())로 본인 것만.
 * unread 배지는 **비보관만** 센다(보관=치웠다는 의사표시인데 배지가 계속 울리면 보관이 무의미).
 */
export async function getMyNotifications(
  view: NotificationView = "active",
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();

  const list = supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at")
    .neq("type", "daily_briefing") // 폐지된 브리핑 알림은 목록 상한을 적용하기 전에 제외한다.
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

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
  return { unread: count ?? 0, items: items.map(presentNotification) };
}
