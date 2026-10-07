import { CONTROL_H_SM, CONTROL_LABEL_SM } from "@/components/ui/control-scale";

/**
 * 회차 확정 표 '실납 청구액' 칸의 동작 버튼(배분 · 이월) — 원장 2026-10-07 *"배분 및 이월을 버튼화"*.
 * 표 안 보조 동작이라 작은 컨트롤 한 벌(`control-scale` sm — 높이는 라벨에서 도출, 손으로 적지 않는다).
 * ⚠️ `whitespace-nowrap` + `shrink-0` — 좁은 창에서 한글 두 글자가 한 글자씩 쪼개지지 않게.
 * ⚠️ 불러오는 동안에도 **라벨을 바꾸지 않는다**(`aria-busy` + 흐림만) — '불러오는 중…'으로 바꾸면 버튼이 두 배 넘게 넓어져
 *    최소 폭 표에서 그 줄이 두 줄로 꺾였다 돌아온다(적대 리뷰 2026-10-07).
 */
export const CELL_ACTION_BUTTON =
  `border-line text-primary hover:bg-primary-soft inline-flex ${CONTROL_H_SM} ${CONTROL_LABEL_SM} shrink-0 items-center rounded-md border px-2 font-medium whitespace-nowrap disabled:opacity-50`;
