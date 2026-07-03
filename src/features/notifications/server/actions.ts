"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getMyNotifications } from "./queries";
import type { NotificationItem } from "../types";

/** 벨 데이터 새로고침(클라 NotificationBell가 마운트·열기·폴링에서 호출). */
export async function fetchMyNotifications(): Promise<{ unread: number; items: NotificationItem[] }> {
  return getMyNotifications();
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
