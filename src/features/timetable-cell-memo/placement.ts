import type { ReactNode } from "react";

/**
 * 떠 있는 상자(메모 · 정보 카드 + 메모 2열)를 **칸 옆**에 놓는 자리 — 순수 함수.
 * 구글 시트 메모처럼 칸 오른쪽에 붙이고, 화면 오른쪽을 넘으면 칸 왼쪽으로, 아래를 넘으면 위로 올린다.
 * 칸 바로 옆(틈 `gap`)이라 마우스를 칸에서 상자로 곧장 옮길 수 있다.
 */

export type Rect = { left: number; top: number; right: number; bottom: number };

export function placeBeside(
  anchor: Rect,
  box: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 2,
  margin = 8,
): { left: number; top: number } {
  let left = anchor.right + gap;
  if (left + box.width > viewport.width - margin) left = anchor.left - gap - box.width;
  if (left < margin) left = Math.max(margin, viewport.width - margin - box.width);
  let top = anchor.top;
  if (top + box.height > viewport.height - margin) top = viewport.height - margin - box.height;
  if (top < margin) top = margin;
  return { left: Math.round(left), top: Math.round(top) };
}

/** 끌어 바꾸는 크기의 화면 상한 — 상자가 창 밖으로 나가지 않게(저장 상한과 별개). */
export function fitToViewport(
  size: { width: number; height: number },
  at: { left: number; top: number },
  viewport: { width: number; height: number },
  margin = 8,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.min(size.width, viewport.width - margin - at.left)),
    height: Math.max(1, Math.min(size.height, viewport.height - margin - at.top)),
  };
}

/**
 * 시간표 hover 정보 카드 옆 **2열 자리**(원장 *"메모는 이 정보의 우측에 보여줄것. 즉 2열느낌으로"*) —
 * 카드(`HoverCard`)가 트리거를 넘겨 물으면 칸 메모 레이어가 그 칸 메모 상자를 돌려준다. 없으면 null(카드만 — 종전 그대로).
 * `anchor` = 칸(td) 자리 — 카드+메모 묶음을 칸 옆에 붙여 마우스를 곧장 옮길 수 있게 한다.
 */
export type HoverAside = { node: ReactNode; width: number; height: number; anchor: Rect };
