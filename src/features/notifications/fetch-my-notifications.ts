import type { NotificationItem } from "./types";
import type { StaffTaskSummary } from "@/features/staff-tasks/kinds";

/** 벨 목록 뷰 — 받은함/보관함(서버 `NotificationView`와 같은 값, 이 파일은 클라도 import해서 따로 적는다). */
export type NotificationListView = "active" | "archived";

export const NOTIFICATIONS_ENDPOINT = "/api/notifications";

/**
 * 벨 목록 응답(서버 `NotificationList`와 같은 모양) — `viewAs` = '다른 강사 뷰'로 그 강사의 받은함을 보는 중(OS 알림 · 중앙 팝업을 띄우지 않는다),
 * `readOnly` = 읽음 · 보관 · 삭제를 할 수 없다('읽기' 강사뷰 — 단추를 감춘다). 평소에는 둘 다 없다(2026-11-05 강사뷰 적대 리뷰).
 */
export type NotificationListResponse = { unread: number; items: NotificationItem[]; tasks?: StaffTaskSummary; viewAs?: true; readOnly?: true };

/**
 * 벨 목록 + 안 읽은 수를 **GET 라우트로** 가져온다(클라 전용 · 서버 액션 아님).
 *
 * 🔴 마운트·폴링처럼 저절로 도는 조회를 서버 액션으로 되돌리지 말 것 — 라우터 작업 큐 경합으로 Next 기본 오류 화면이
 *    뜬다(gotchas #137, 가드 `shell-autocall-server-actions.test.ts`). 읽음·보관·삭제처럼 **누를 때만** 부르는 것은 액션 그대로.
 * 실패(네트워크·500 등 2xx가 아닌 응답)는 throw — 벨의 `run`이 조용히 삼키고 지난 목록을 유지한다.
 * 로그인이 풀렸으면 라우트가 종전 액션처럼 200 + 빈 목록을 준다(배지 0).
 */
export async function fetchMyNotificationsList(
  view: NotificationListView,
  limit: number,
): Promise<NotificationListResponse> {
  const qs = new URLSearchParams({ view, limit: String(limit) });
  const res = await fetch(`${NOTIFICATIONS_ENDPOINT}?${qs.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`notifications ${res.status}`);
  return (await res.json()) as NotificationListResponse;
}
