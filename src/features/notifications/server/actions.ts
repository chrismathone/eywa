"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getMyNotifications, type NotificationView } from "./queries";
import type { NotificationItem } from "../types";

// ⚠️ 이 파일의 액션엔 **일부러 감사로그(logAction)를 달지 않는다**(2026-09-09 전수 점검).
// 넷 다 RLS가 `recipient_id = auth.uid()`로 잠근 **본인 받은함**만 바꾼다(0074a: select·update·delete
// 정책 전부) — id를 넘겨도 남의 알림은 0행이라, 다른 사람이 관찰할 수 있는 변화가 하나도 없다.
// 읽음·보관은 하루에도 수십 번 눌리는 칸이라 남기면 감사로그가 그 사람 벨 조작으로 뒤덮여
// 정작 삭제 같은 줄이 묻힌다(회의록 메모장 저장을 뺀 것과 같은 판단).
// 🔴 **남에게 알림을 보내는 쪽**(notify.ts·events.ts)은 이 규칙 밖이다 — 거긴 남의 화면을 바꾼다.
// 🔴 알림 영구 삭제도 여기선 본인 것뿐이라 뺐다. 남의 알림을 지우는 경로가 새로 생기면 그건 남길 것.

/** 벨 데이터 새로고침(클라 NotificationBell가 마운트·열기·폴링에서 호출). view=받은함/보관함. */
export async function fetchMyNotifications(
  view: NotificationView = "active",
  limit?: number,
): Promise<{ unread: number; items: NotificationItem[] }> {
  return getMyNotifications(view, limit);
}

/**
 * 알림 읽음 처리 — ids 지정 시 그것만, 없으면 내 안 읽은 알림 전체. RLS로 본인 것만 갱신되므로
 * 남의 알림을 읽음 처리할 수 없다(id를 넘겨도 recipient_id≠auth.uid()면 0행). 갱신 후 최신 상태 반환.
 */
export async function markNotificationsRead(
  ids?: string[],
  view: NotificationView = "active",
  limit?: number,
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
  return getMyNotifications(view, limit);
}

/**
 * 알림 보관(0125a) — 받은함에서 치우고 보관함으로. RLS(update: recipient_id=auth.uid())로 본인 것만.
 * view = 호출한 화면의 현재 뷰(응답으로 그 뷰 목록을 갱신해 돌려준다).
 */
export async function archiveNotification(
  id: string,
  view: NotificationView = "active",
  limit?: number,
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  await supabase.from("notifications").update({ archived_at: new Date().toISOString() }).eq("id", id);
  return getMyNotifications(view, limit);
}

/** 보관 해제 — 보관함에서 받은함으로 복원. */
export async function unarchiveNotification(
  id: string,
  view: NotificationView = "archived",
  limit?: number,
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  await supabase.from("notifications").update({ archived_at: null }).eq("id", id);
  return getMyNotifications(view, limit);
}

/** 알림 영구 삭제 — RLS(delete: recipient_id=auth.uid(), 0074a)로 본인 것만. 복구 불가(보관이 안전판). */
export async function deleteNotification(
  id: string,
  view: NotificationView = "active",
  limit?: number,
): Promise<{ unread: number; items: NotificationItem[] }> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };
  const supabase = await createClient();
  await supabase.from("notifications").delete().eq("id", id);
  return getMyNotifications(view, limit);
}
