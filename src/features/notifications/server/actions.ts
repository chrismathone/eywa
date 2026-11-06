"use server";

import { DIGEST_TYPE, getMyNotifications, type NotificationList, type NotificationView } from "./queries";
import { notificationInbox, type NotificationInbox } from "./inbox";

// ⚠️ 이 파일의 액션엔 **일부러 감사로그(logAction)를 달지 않는다**(2026-09-09 전수 점검).
// 넷 다 **받은함**(`notificationInbox` — 평소 본인 · RLS `recipient_id = auth.uid()`도 함께)만 바꾼다(0074a: select·update·delete
// 정책 전부) — 모든 쓰기에 받는 사람 · 지점을 명시하므로 id를 넘겨도 남의 알림은 0행이다.
// '다른 강사 뷰'('전체')는 그 강사의 받은함을 그 강사로서 정리하는 것이다(원장 2026-11-05 *"실제 그 사람으로 완벽하게 전환"*).
// '읽기' 강사뷰는 보기만이라 바꾸지 않는다(inbox.writable).
// 읽음·보관은 하루에도 수십 번 눌리는 칸이라 남기면 감사로그가 그 사람 벨 조작으로 뒤덮여
// 정작 삭제 같은 줄이 묻힌다(회의록 메모장 저장을 뺀 것과 같은 판단).
// 🔴 **남에게 알림을 보내는 쪽**(notify.ts·events.ts)은 이 규칙 밖이다 — 거긴 남의 화면을 바꾼다.
// 🔴 알림 영구 삭제도 여기선 본인 것뿐이라 뺐다. 남의 알림을 지우는 경로가 새로 생기면 그건 남길 것.

// 🔴 벨 목록 **조회**(마운트·이동·포커스·60초 폴링)는 여기 없다 — GET 라우트 `/api/notifications`가 같은
//    `getMyNotifications`를 부른다(2026-10-01). 저절로 도는 조회를 서버 액션으로 두면 라우터 작업 큐 경합으로
//    Next 기본 오류 화면이 떴다(gotchas #137). 이 파일엔 **누를 때만** 부르는 쓰기 액션만 둔다.

/**
 * 알림 읽음 처리 — ids 지정 시 그것만, 없으면 받은함의 안 읽은 알림 전체. 받는 사람 · 지점을 명시해 갱신하므로
 * 남의 알림을 읽음 처리할 수 없다(id를 넘겨도 받는 사람이 다르면 0행). 갱신 후 최신 상태 반환.
 */
export async function markNotificationsRead(
  ids?: string[],
  view: NotificationView = "active",
  limit?: number,
): Promise<NotificationList> {
  const inbox = await writableInbox();
  if (!inbox) return getMyNotifications(view, limit);
  let q = inbox.db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", inbox.tenantId)
    .eq("recipient_id", inbox.recipientId)
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
): Promise<NotificationList> {
  const inbox = await writableInbox();
  if (!inbox) return getMyNotifications(view, limit);
  await archiveHiddenDigests(inbox, id);
  await inbox.db.from("notifications").update({ archived_at: new Date().toISOString() })
    .eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId).eq("id", id);
  return getMyNotifications(view, limit);
}

/** 바꿀 수 있는 받은함 — 지점 보기 · '읽기' 강사뷰 · 비로그인이면 null(목록만 돌려준다). */
async function writableInbox(): Promise<NotificationInbox | null> {
  const inbox = await notificationInbox();
  return inbox?.writable ? inbox : null;
}

/**
 * 받은함의 기한 초과 업무 요약은 가장 최근 한 장만 보인다(queries.ts) — 그 한 장을 보관 · 삭제하면 가려 둔 지난 요약도 함께 보관한다.
 * 안 그러면 다음 갱신에 하루 전 요약이 안 읽음으로 다시 올라온다(배지도 그대로). 보관함에서 지우는 요약은 받은함과 상관없다.
 */
async function archiveHiddenDigests(inbox: NotificationInbox, id: string): Promise<void> {
  const { data } = await inbox.db.from("notifications").select("type, archived_at, created_at")
    .eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId).eq("id", id).maybeSingle();
  if (data?.type !== DIGEST_TYPE || data.archived_at !== null) return;
  // 그보다 **앞선** 요약만 — 화면이 갱신되기 전(최대 60초)에 새로 온 오늘 요약은 한 번도 안 보인 채 보관되지 않게.
  await inbox.db.from("notifications").update({ archived_at: new Date().toISOString() })
    .eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId).eq("type", DIGEST_TYPE).is("archived_at", null).lt("created_at", data.created_at);
}

/** 보관 해제 — 보관함에서 받은함으로 복원. */
export async function unarchiveNotification(
  id: string,
  view: NotificationView = "archived",
  limit?: number,
): Promise<NotificationList> {
  const inbox = await writableInbox();
  if (!inbox) return getMyNotifications(view, limit);
  await inbox.db.from("notifications").update({ archived_at: null })
    .eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId).eq("id", id);
  return getMyNotifications(view, limit);
}

/** 알림 영구 삭제 — 받은함 것만(받는 사람 · 지점 명시 + 평소엔 RLS delete 정책도, 0074a). 복구 불가(보관이 안전판). */
export async function deleteNotification(
  id: string,
  view: NotificationView = "active",
  limit?: number,
): Promise<NotificationList> {
  const inbox = await writableInbox();
  if (!inbox) return getMyNotifications(view, limit);
  await archiveHiddenDigests(inbox, id);
  await inbox.db.from("notifications").delete().eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId).eq("id", id);
  return getMyNotifications(view, limit);
}

/**
 * 알림 전체 삭제 — **지금 보고 있는 뷰**(받은 알림 / 보관함) 전체를 영구 삭제한다(목록 밖 포함).
 * 받는 사람 · 지점을 명시해 받은함 것만 지운다(필터 없는 일괄 삭제 금지 · 평소엔 RLS delete 정책도).
 * 다른 뷰는 건드리지 않는다 — 받은 알림을 비워도 보관함은 남는다.
 * '지점 보기' 중엔 벨이 비어 있으므로(queries.ts) 보이지 않는 운영자 본인 알림을 지우지 않게 막는다.
 * upTo = 화면에 보이던 가장 최근 알림 시각 — 확인을 누르는 사이 새로 온 알림은 보지도 못했으니 남긴다.
 */
export async function deleteAllNotifications(
  view: NotificationView = "active",
  limit?: number,
  upTo?: string,
): Promise<NotificationList> {
  const inbox = await writableInbox();
  if (!inbox) return getMyNotifications(view, limit);
  let q = inbox.db.from("notifications").delete().eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId);
  if (upTo) q = q.lte("created_at", upTo);
  await (view === "archived" ? q.not("archived_at", "is", null) : q.is("archived_at", null));
  return getMyNotifications(view, limit);
}
