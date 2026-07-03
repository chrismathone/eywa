import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { NotificationItem } from "../types";

const LIST_LIMIT = 20;

/** 내 알림 목록(최신순) + 안 읽은 수 — RLS(recipient_id=auth.uid())로 본인 것만. */
export async function getMyNotifications(): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();

  // 목록(최근 20)과 안읽음 카운트는 독립 → 병렬(B4). 카운트는 head:true로 행 미수신.
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .is("read_at", null),
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
  return { unread: count ?? 0, items };
}
