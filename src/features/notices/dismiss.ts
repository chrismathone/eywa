// 공지 팝업 dismiss 판정 — 순수 로직(서버 쿼리·서버 액션·테스트가 공유).
// 저장소는 계정 단위 DB(notice_dismissals, 0162a). 이전엔 브라우저 localStorage였는데 origin(포트 포함)
// 단위라 "다시 보지 않기"가 dev 포트·브라우저·PC마다 따로 놀았다.

export type DismissMode = "today" | "week" | "forever";

/** 한 행 = 한 사람의 한 팝업 dismiss. until=null이면 영구, version=dismiss 시점 팝업 updated_at. */
export type DismissRecord = { until: string | null; version: string };

const DAY = 86_400_000;

/** dismiss 만료 시각(epoch ms). forever = null(무기한). */
export function dismissUntil(mode: DismissMode, nowMs: number): number | null {
  if (mode === "forever") return null;
  return nowMs + (mode === "week" ? 7 * DAY : DAY);
}

/**
 * 이 팝업을 숨겨야 하는가. 팝업이 수정되면(version≠현재 updated_at) 옛 dismiss는 무시하고 다시 보여준다.
 * 파싱 불가 값은 NaN 비교로 자동 "보임" 처리 — 판단 못 하면 숨기지 않는다(공지를 삼키지 않는 쪽이 안전).
 */
export function isDismissed(
  record: DismissRecord | undefined,
  popupUpdatedAt: string,
  nowMs: number,
): boolean {
  if (!record) return false;
  if (Date.parse(record.version) !== Date.parse(popupUpdatedAt)) return false;
  if (record.until === null) return true;
  return Date.parse(record.until) > nowMs;
}
