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
  // 보고서가 학부모에게 **안 갔는데 아무도 모르는** 상태를 끝내려면 벨 배지로는 약하다(원장 2026-07-23:
  // "안 그러면 영원히 모를듯"). 빈도 걱정은 실측으로 해소 — 전체 12,483건 중 failed 1건이고,
  // 발화도 'failed 전이' 1회뿐이다. 다발 시에도 팝업은 최신 1건 + "외 N건"이라 폭주하지 않는다.
  "report_send_failed",
  // 공지도 같은 이유 — 학부모에게 안 갔는데 아무도 모르는 상태를 끝내려면 담당이 초대해야 한다(0144a).
  "notice_send_failed",
];

/**
 * ⚠️ **`classnote_parent_comment`(학부모 댓글)는 일부러 여기 없다 — 벨 배지로만 알린다.**
 *
 * 위 "즉시 응답이 필요한 것만"(원장 결정)에 댓글은 해당하지 않는다. 실측(2026-07-16): 학부모 댓글은
 * **하루 ~12건으로 새 글(4.2건)의 3배**이고 표본 70건 중 **36건이 "감사합니다 ⭐️" 류 인사**다.
 * 이걸 중앙 팝업으로 띄우면 하루 여러 번 **수업 중 화면을 가로막는데**, 그 절반이 인사다 — 팝업이 무시되기
 * 시작하면 정작 새 글 팝업까지 같이 무시된다(경보 피로). 벨은 본문이 그대로 보여 1초면 넘길 수 있으므로
 * 노이즈가 벨에 쌓이는 건 감당 가능하다.
 * → 댓글을 이 목록에 넣지 말 것. 넣으려면 먼저 "인사성 댓글 거르기"가 있어야 한다(원장이 반응 보고 조정하기로 함).
 */

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
