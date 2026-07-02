/**
 * 대시보드 순수 계산 — 표현 컴포넌트에서 분리(테스트 강제). RLS·DB 무관.
 * (구 buildActionItems/ActionItem은 소비처 0으로 삭제 — "오늘 조치할 것"은 today-actions.ts가 담당.)
 */

/** 이번 달 순증감(신규 - 퇴원). */
export function enrollmentDelta(newCount: number, withdrawn: number): number {
  return newCount - withdrawn;
}

/** 시계열 변화량(마지막 - 처음). 점이 2개 미만이면 0. */
export function trendDelta(points: number[]): number {
  if (points.length < 2) return 0;
  return points[points.length - 1] - points[0];
}
