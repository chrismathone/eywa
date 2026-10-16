import { CAPSULE_HEIGHT, CAPSULE_WIDTH, type Box } from "./recording-panel-placement";

/**
 * 녹음 아이콘끼리 겹치지 않게 자리 잡기(원장 2026-10-16 "녹음 아이콘들은 겹치려고 이동시키면 겹쳐지지않고 자동으로 깔끔하게
 * 정렬되게"). 끌어 놓은 자리가 다른 아이콘과 겹치거나 바짝 붙으면, 가장 가까이 있던 그 아이콘의 줄(같은 왼쪽 끝)에 일정한
 * 간격(`STACK_GAP`)으로 붙인다 — 놓은 곳에서 가장 가까운 빈칸. 그 줄에 자리가 없으면 옆 줄. 새 아이콘이 처음 뜰 때(오른쪽
 * 아래에서 위로 쌓기)와 창 크기가 바뀔 때도 같은 함수를 쓴다.
 *
 * DOM을 모르는 순수 함수 — 측정은 호출부(`use-recording-position.ts`)가 한다.
 */
export const STACK_GAP = 12;
export const CAPSULE_EDGE = 16;

type Point = { left: number; top: number };
const box = (at: Point): Box => ({ ...at, width: CAPSULE_WIDTH, height: CAPSULE_HEIGHT });
/** 겹치거나 표준 간격보다 가까우면 부딪친 것으로 본다. */
const crowds = (a: Box, b: Box) =>
  a.left < b.left + b.width + STACK_GAP && b.left < a.left + a.width + STACK_GAP
  && a.top < b.top + b.height + STACK_GAP && b.top < a.top + a.height + STACK_GAP;

export function clampCapsule(at: Point, viewport: { width: number; height: number }): Point {
  const maxLeft = Math.max(CAPSULE_EDGE, viewport.width - CAPSULE_WIDTH - CAPSULE_EDGE);
  const maxTop = Math.max(CAPSULE_EDGE, viewport.height - CAPSULE_HEIGHT - CAPSULE_EDGE);
  return { left: Math.min(Math.max(at.left, CAPSULE_EDGE), maxLeft), top: Math.min(Math.max(at.top, CAPSULE_EDGE), maxTop) };
}

export function settleCapsule(at: Point, others: readonly Box[], viewport: { width: number; height: number }): Point {
  const want = clampCapsule(at, viewport);
  if (!others.some((other) => crowds(box(want), other))) return want;
  const center = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
  const mine = center(box(want));
  const distance = (b: Box) => Math.hypot(center(b).x - mine.x, center(b).y - mine.y);
  const anchor = [...others].sort((a, b) => distance(a) - distance(b))[0];
  const stepX = CAPSULE_WIDTH + STACK_GAP;
  const stepY = CAPSULE_HEIGHT + STACK_GAP;
  const reach = others.length + 1;
  let best: { at: Point; cost: number } | null = null;
  // 같은 줄이 먼저(옆 줄은 한 칸만큼 비용을 더 얹는다) — 같은 거리면 줄을 지킨다.
  for (const [column, penalty] of [[0, 0], [-1, stepX], [1, stepX]] as const) {
    for (let k = -reach; k <= reach; k += 1) {
      const candidate = { left: anchor.left + column * stepX, top: anchor.top + k * stepY };
      if (clampCapsule(candidate, viewport).left !== candidate.left || clampCapsule(candidate, viewport).top !== candidate.top) continue;
      if (others.some((other) => crowds(box(candidate), other))) continue;
      const cost = Math.hypot(candidate.left - want.left, candidate.top - want.top) + penalty;
      if (!best || cost < best.cost) best = { at: candidate, cost };
    }
  }
  return best?.at ?? want;
}
