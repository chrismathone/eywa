import "server-only";
import { notificationInbox } from "./inbox";
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

/** 하루 한 번 새 행으로 오는 '기한 초과 업무 N건' 요약(staff-tasks/server/digest.ts). */
export const DIGEST_TYPE = "staff_task_digest";

const COLS = "id, type, title, body, link, read_at, created_at";
type Row = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
/** 목록과 같은 순서(안 읽음 먼저 · 각각 최근순)에 요약 한 장을 끼우고 상한으로 자른다. */
function withDigest(rows: Row[], digest: Row, cap: number): Row[] {
  const rank = (r: Row) => (r.read_at === null ? 0 : 1);
  return [...rows, digest].sort((a, b) => rank(a) - rank(b) || Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, cap);
}

/**
 * 내 알림 목록(최신순) + 안 읽은 수 — 받은함(`notificationInbox`)의 받는 사람 것만(평소 = 본인 · RLS도 함께, '다른 강사 뷰' = 그 강사).
 * unread 배지는 **비보관만** 센다(보관=치웠다는 의사표시인데 배지가 계속 울리면 보관이 무의미).
 */
/**
 * 벨이 받는 목록. `viewAs` = '다른 강사 뷰'로 그 강사의 받은함을 보는 중(벨은 OS 알림 · 중앙 팝업을 띄우지 않는다),
 * `readOnly` = 읽음 · 보관 · 삭제를 할 수 없다('읽기' 강사뷰 — 벨이 그 단추를 감춘다). 평소에는 둘 다 없다(2026-11-05 강사뷰 적대 리뷰).
 */
export type NotificationList = { unread: number; items: NotificationItem[]; tasks?: StaffTaskSummary; viewAs?: true; readOnly?: true };

export async function getMyNotifications(
  view: NotificationView = "active",
  limit: number = NOTIFICATION_LIST_LIMIT,
): Promise<NotificationList> {
  // 운영 콘솔의 '지점 보기'(읽기 전용) 중에는 벨을 비운다 — 알림은 지점이 아니라 **받는 사람**으로 걸러지는 표라
  // 그대로 읽으면 운영자 본인이 자기 지점에서 받은 알림이 보는 지점 화면에 뜬다(inbox.ts가 null).
  // 보기 쿠키가 남아 있는데 보기가 아닌 요청(끝났다 · 확인하지 못했다)도 같다 — 그 브라우저에는 보기 띠를 단 탭이 남아 있을 수 있다.
  const inbox = await notificationInbox();
  if (!inbox) return { unread: 0, items: [] };
  // 받는 사람 · 지점을 **늘 명시**한다 — '다른 강사 뷰'는 관리 연결(RLS 없음)로 대상 강사 알림을 읽는다(inbox.ts).
  const mine = () => inbox.db.from("notifications");
  // 내 할 일 수(0377a)는 목록과 상관없다 — 먼저 띄워 두고 함께 기다린다(B4).
  const summaryPromise = myTaskSummary();
  // 기한 초과 업무 요약은 **가장 최근 한 장만** 받은함 · 배지에 둔다(원장 2026-11-02 *"너무 알림이 정신없음"* — 숫자만 다른 같은 카드가
  // 매일 한 장씩 쌓여 받은함 위를 덮었다). 받은함 목록 · 수에서는 요약을 빼고, 보관 안 한 가장 최근 요약 한 장을 **함께** 읽어 끼운다(B4 —
  // 기다리는 차례를 늘리지 않는다). 지난 요약은 지우지도 읽음으로 바꾸지도 않고 받은함에서만 가린다(30일 정리 0447a 그대로) — 보이는 요약을
  // 보관 · 삭제하면 가린 지난 요약도 함께 보관한다(actions.ts · 안 그러면 하루 전 요약이 다시 올라온다).
  // 🔴 배지 수 · 최근 요약은 보관함 화면에서도 같게 센다 — 벨은 어느 화면의 응답이든 이 수로 배지를 덮는다. 목록에 끼우는 것만 받은함.
  const collapse = view === "active";

  // 안 읽은 알림이 위로(원장 2026-10-29 *"안읽은 알림이 상단에 오도록"*) — 안 읽음을 상한까지 먼저, 남은 자리를 읽은 알림(최근순)으로.
  //    서버에서 나눠 읽어야 '더 보기'(상한을 늘려 다시 읽음)를 해도 순서가 흔들리지 않는다.
  const cap = clampNotificationLimit(limit);
  const page = (read: boolean, size: number) => {
    const base = mine()
      .select(COLS)
      .eq("tenant_id", inbox.tenantId)
      .eq("recipient_id", inbox.recipientId)
      .neq("type", "daily_briefing") // 폐지된 브리핑 알림은 목록 상한을 적용하기 전에 제외한다.
      .order("created_at", { ascending: false })
      .limit(size);
    const q = collapse ? base.neq("type", DIGEST_TYPE) : base;
    const scoped = view === "archived" ? q.not("archived_at", "is", null) : q.is("archived_at", null);
    return read ? scoped.not("read_at", "is", null) : scoped.is("read_at", null);
  };
  const listPromise = page(false, cap).then(async (unreadPage) => {
    if (unreadPage.error) return unreadPage;
    const first = unreadPage.data ?? [];
    if (first.length >= cap) return unreadPage;
    const readPage = await page(true, cap - first.length);
    // 읽은 쪽만 실패하면 안 읽은 알림이라도 보인다(벨이 통째로 비지 않게).
    return readPage.error ? { ...unreadPage, data: first } : { ...readPage, data: [...first, ...(readPage.data ?? [])] };
  });
  const countPromise = (() => {
    const base = mine()
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", inbox.tenantId)
      .eq("recipient_id", inbox.recipientId)
      .neq("type", "daily_briefing"); // 보이지 않는 알림 때문에 배지가 남지 않도록 같은 기준 사용.
    return base.neq("type", DIGEST_TYPE).is("read_at", null).is("archived_at", null);
  })();
  const digestPromise = mine().select(COLS).eq("tenant_id", inbox.tenantId).eq("recipient_id", inbox.recipientId).eq("type", DIGEST_TYPE).is("archived_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  // 목록 · 안읽음 카운트 · 최근 요약은 서로 독립 → 병렬(B4). 카운트는 head:true로 행 미수신.
  const [listed, { count }, digest] = await Promise.all([listPromise, countPromise, digestPromise]);
  // 요약을 못 읽으면 이번엔 요약 없이 낸다(목록 · 배지는 그대로 — 다음 갱신에 다시 읽는다).
  const latest = !digest.error ? ((digest.data as Row | null) ?? null) : null;
  const data = latest && collapse && !listed.error ? withDigest((listed.data ?? []) as Row[], latest, cap) : listed.data;

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
    unread: (count ?? 0) + (latest && latest.read_at === null ? 1 : 0),
    items: items.map((i) => {
      const task = badges.get(i.id);
      return presentNotification(task ? { ...i, task } : i);
    }),
    ...(summary ? { tasks: summary } : {}),
    ...(inbox.viewAs ? { viewAs: true as const } : {}),
    ...(!inbox.writable ? { readOnly: true as const } : {}),
  };
}
