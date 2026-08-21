/**
 * 출석부 금액 표기 — 학생 행·합계 줄이 **같은 함수**를 쓴다.
 *
 * 🔑 `matrix-row.tsx`(서버 렌더)에 있던 것을 여기로 옮겼다: 합계 줄이 검색을 따라가려면 클라 컴포넌트가
 *    돼야 하는데, 그쪽에서 `matrix-row`를 import하면 학생 행 컴포넌트가 통째로 클라 번들에 딸려 온다.
 */

/** 0원과 '자료 없음'을 구분한다(청구서가 없는 달은 "—"). */
export function formatMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("ko-KR");
}
