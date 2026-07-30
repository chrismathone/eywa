/**
 * 수납 화면·엑셀이 **같은 집합**을 말하게 하는 단일 판정 모듈(순수 함수).
 *
 * 배경: '기한 경과' 판정이 화면(billing-content.tsx)과 엑셀 라우트에 **복제**돼 있었다. 한쪽만 고치면
 * "화면과 같은 집합을 내보낸다"는 주석이 조용히 거짓이 된다 — 한 레코드의 여러 표면은 공용 게이트를
 * 통과해야 한다(gotchas #77). 새로 추가하는 '동기화 누락' 필터도 처음부터 여기 둔다.
 *
 * ⚠️ 여기엔 서버 전용 import를 넣지 말 것 — 클라이언트가 import하는 순간 빌드가 깨진다(gotchas #81).
 */

/** 기한 경과 = 미완납(unpaid|partial) + 납부기한이 오늘보다 이전. */
export function isOverdue(
  row: { status: string; dueDate: string | null },
  today: string,
): boolean {
  return (row.status === "unpaid" || row.status === "partial") && row.dueDate !== null && row.dueDate < today;
}

/**
 * 동기화 창 밖 판정 기준(ms). makeedu 동기화가 **하루 2회**(06:00·18:00)라 26시간 이상 미갱신이면
 * 최소 두 번을 건너뛴 것 = 그 스크랩에 없었다고 본다.
 * ⚠️ 동기화 주기를 바꾸면 이 값도 함께 바꿀 것(주기보다 커야 정상 실행에서 오탐이 안 난다).
 */
export const SYNC_STALE_MS = 26 * 60 * 60 * 1000;

/** 이 달 행들이 마지막으로 스크랩에 잡힌 시각(가장 최근 updated_at). 행이 없으면 null. */
export function lastTouchedAt(rows: { updatedAt: string | null }[]): string | null {
  return rows.reduce<string | null>(
    (max, r) => (r.updatedAt && (!max || r.updatedAt > max) ? r.updatedAt : max),
    null,
  );
}

/**
 * 이 달 전체가 스크랩 범위 밖인가(= 통째로 동결된 달).
 *
 * makeedu 상세수납은 **가장 최근 청구월 한 달만** 보여주고 스크랩에 월 파라미터가 없어서, 다음 달 청구가
 * 시작되는 순간 직전 달은 그 뒤로 한 번도 갱신되지 않는다(2026-07은 07-16 18:00에 멈췄고 07-17 06:00부터
 * 2026-08로 바통이 넘어갔다 — 실측). 임포터 upsert는 값이 같아도 `updated_at = now()`를 쓰므로
 * "이 달 최신 updated_at"이 곧 커버리지 프록시가 된다.
 */
export function isOutsideSyncWindow(args: {
  rows: { updatedAt: string | null }[];
  syncedAt: string | null | undefined;
}): boolean {
  const last = lastTouchedAt(args.rows);
  if (!args.syncedAt || !last) return false;
  return new Date(args.syncedAt).getTime() - new Date(last).getTime() > SYNC_STALE_MS;
}

/**
 * 이 **행**이 마지막 동기화에 없었는가(= makeedu에서 사라진 청구).
 *
 * ⚠️ 동결된 달(`outsideSyncWindow`)에서는 전 행이 미갱신이라 이 판정이 무의미하다 — 그 달에선 항상 false.
 *    (안 그러면 2026-07의 401건 전부가 '사라진 청구'로 표시된다.)
 */
export function isMissingFromMakeedu(args: {
  row: { updatedAt: string | null };
  syncedAt: string | null | undefined;
  outsideSyncWindow: boolean;
}): boolean {
  if (args.outsideSyncWindow || !args.syncedAt || !args.row.updatedAt) return false;
  return new Date(args.syncedAt).getTime() - new Date(args.row.updatedAt).getTime() > SYNC_STALE_MS;
}
