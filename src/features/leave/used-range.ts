/**
 * 연차 조정의 **휴가 사용 기간 표기** — 순수 함수 단일 소스(관리자 조정 창 · 내 정보 카드 공용, Vitest).
 *
 * 🔑 두 화면이 같은 글자를 써야 한다 — 한쪽이 `2026-08-15 ~ 2026-08-17`, 다른 쪽이 `8/15~17`이면 같은
 *    줄을 보고도 다른 기록처럼 읽힌다.
 * ⚠️ 끝이 비었거나 시작과 같으면 **하루**다(칸을 비워 두는 것이 정상 — 0271a).
 * ⚠️ 같은 해·같은 달이면 뒤쪽을 줄여 적는다(좁은 칸에서 두 줄로 접히지 않게). 해가 다르면 통째로 적는다.
 */
export function usedRangeLabel(start: string, end?: string | null): string {
  if (!end || end === start) return start;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && start.slice(5, 7) === end.slice(5, 7);
  if (sameMonth) return `${start}~${end.slice(8)}`;
  if (sameYear) return `${start}~${end.slice(5)}`;
  return `${start}~${end}`;
}
