/**
 * 원생상담 목록의 행 격자 두 벌 — 행(=단) 폭이 정한다(`@container/row`): 보통 / 넓음(64rem~, 상담자 뒤에 요약 열).
 * 목록([consultation-list.tsx](./consultation-list.tsx) — 열 폭 변수 `--row`·`--row-l`·`--right`를 정한다)과 행([consultation-row.tsx](./consultation-row.tsx))이 같이 쓴다.
 * 🔴 폰 두 줄 카드(`phone:`)는 이 벌들과 같은 속성을 다투므로 `!`로 이긴다(폭 656px 넘는 폰 가로·좁은 브라우저).
 */
export const ROW_GRID = "grid-cols-(--row) @5xl/row:grid-cols-(--row-l)";
