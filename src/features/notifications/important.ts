import type { NotificationItem } from "./types";

/**
 * 알림 "강하게 알리기" 대상 판정 — 순수 함수(Vitest).
 *
 * 우상단 벨만으로는 강사가 못 보고 지나친다(원장 2026-07-15: "우상단 알림으로는 너무 약하다").
 * 그래서 **중요 알림**은 컴퓨터(OS) 알림 + 화면 중앙 팝업으로 확실히 알린다.
 * ⚠️ 모든 알림을 중앙 팝업하면 수업 중 방해가 되므로 **즉시 응답이 필요한 것만** 넣는다(원장 결정).
 * 나머지 유형(반 배정·전입·인수인계)은 기존처럼 벨 배지로만.
 */
export const IMPORTANT_NOTIFICATION_TYPES: readonly string[] = [
  "classnote_parent_post", // 학부모가 ClassNote에 새 글 → 담당 강사가 바로 확인·응답해야 함
];

/** 이 유형이 강하게 알릴 대상인가. */
export function isImportantNotification(type: string | null | undefined): boolean {
  return !!type && IMPORTANT_NOTIFICATION_TYPES.includes(type);
}

/**
 * 이번에 강하게 알릴 항목만 골라낸다 — **안 읽음 + 중요 유형 + 아직 안 알림**.
 * @param alerted 이미 알린 id 집합(localStorage 영속) — 새로고침·다중 탭에서 같은 알림이 반복해서
 *   팝업되는 것을 막는다. 한 알림당 팝업은 **평생 1회**(놓쳤으면 벨에 그대로 남아 있음).
 * 최신순 입력을 그대로 유지해 호출부가 [0]을 대표로 쓴다.
 */
export function pickAlertTargets(items: NotificationItem[], alerted: ReadonlySet<string>): NotificationItem[] {
  return items.filter((n) => !n.read && isImportantNotification(n.type) && !alerted.has(n.id));
}

/** 알림 id 기록 상한 — 무한 증가 방지(오래된 건 어차피 읽음/삭제되어 다시 뜰 일 없음). */
export const ALERTED_CAP = 200;

/** 알린 id 집합에 새 id들을 더하고 상한으로 자른다(최신 우선 보존). 순수. */
export function mergeAlerted(prev: readonly string[], addIds: readonly string[]): string[] {
  const merged = [...addIds, ...prev.filter((id) => !addIds.includes(id))];
  return merged.slice(0, ALERTED_CAP);
}
