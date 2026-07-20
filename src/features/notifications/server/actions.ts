"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getMyNotifications, type NotificationView } from "./queries";
import type { NotificationItem } from "../types";

/** 벨 데이터 새로고침(클라 NotificationBell가 마운트·열기·폴링에서 호출). view=받은함/보관함. */
export async function fetchMyNotifications(
  view: NotificationView = "active",
): Promise<{ unread: number; items: NotificationItem[] }> {
  return getMyNotifications(view);
}

/**
 * 알림 읽음 처리 — ids 지정 시 그것만, 없으면 내 안 읽은 알림 전체. RLS로 본인 것만 갱신되므로
 * 남의 알림을 읽음 처리할 수 없다(id를 넘겨도 recipient_id≠auth.uid()면 0행). 갱신 후 최신 상태 반환.
 */
export async function markNotificationsRead(
  ids?: string[],
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  let q = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (ids && ids.length > 0) q = q.in("id", ids.slice(0, 100)); // #53 방어(과대 배열 방지)
  await q;
  return getMyNotifications();
}

/**
 * 알림 보관(0125a) — 받은함에서 치우고 보관함으로. RLS(update: recipient_id=auth.uid())로 본인 것만.
 * view = 호출한 화면의 현재 뷰(응답으로 그 뷰 목록을 갱신해 돌려준다).
 */
export async function archiveNotification(
  id: string,
  view: NotificationView = "active",
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  await supabase.from("notifications").update({ archived_at: new Date().toISOString() }).eq("id", id);
  return getMyNotifications(view);
}

/** 보관 해제 — 보관함에서 받은함으로 복원. */
export async function unarchiveNotification(
  id: string,
  view: NotificationView = "archived",
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  await supabase.from("notifications").update({ archived_at: null }).eq("id", id);
  return getMyNotifications(view);
}

/** 알림 영구 삭제 — RLS(delete: recipient_id=auth.uid(), 0074a)로 본인 것만. 복구 불가(보관이 안전판). */
export async function deleteNotification(
  id: string,
  view: NotificationView = "active",
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  await supabase.from("notifications").delete().eq("id", id);
  return getMyNotifications(view);
}
