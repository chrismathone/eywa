/**
 * 대시보드 편집기 캔버스의 기하 — **순수 함수**(Vitest). 격자 자리(`flow.ts`의 x·y·w·h) ↔ 화면 픽셀, 끌어서 끼울 자리, 손잡이 크기.
 * 편집 중엔 줄 높이를 고정한다(카드 = 가벼운 얼굴) — 끄는 동안 줄 높이가 바뀌면 포인터 아래 자리가 흔들린다.
 */
import { GRID_COLS, isHeadingId, type Placed } from "@/features/dashboard/layout/types";

export const ROW_H = 104;
export const HEADING_H = 44;
export const GAP = 12;

/** 감쇠 스프링(ζ≈0.68, 0.6초) — `linear()` 이징. 지원 안 하는 브라우저는 CSS의 앞 줄(cubic-bezier)이 남는다. */
export const SPRING =
  "linear(0, 0.044, 0.152, 0.291, 0.44, 0.583, 0.709, 0.815, 0.899, 0.961, 1.005, 1.033, 1.048, 1.054, 1.053, 1.048, 1.041, 1.033, 1.025, 1.018, 1.012, 1.007, 1.003, 1, 1)";

export type Rect = { left: number; top: number; width: number; height: number };
export type Metrics = { colStep: number; rowTops: number[]; rowHeights: number[]; height: number };
export type BoardLayout = { placed: Placed[]; metrics: Metrics; rects?: ReadonlyMap<string, Rect>; columnScale?: number };

/** 줄마다 높이(머리줄만 있는 줄은 낮게) → 줄의 위치. `extraRows`만큼 빈 줄을 더 둔다(끄는 동안 맨 아래에 놓을 자리). */
export function metricsOf(placed: readonly Placed[], width: number, extraRows = 0): Metrics {
  const colStep = (width + GAP) / GRID_COLS;
  const rows = Math.max(0, ...placed.map((p) => p.y + p.h)) + extraRows;
  const rowHeights = Array.from({ length: rows }, (_, y) => {
    const here = placed.filter((p) => p.y <= y && p.y + p.h > y);
    return here.length > 0 && here.every((p) => isHeadingId(p.id)) ? HEADING_H : ROW_H;
  });
  const rowTops: number[] = [];
  let top = 0;
  for (const h of rowHeights) {
    rowTops.push(top);
    top += h + GAP;
  }
  return { colStep, rowTops, rowHeights, height: Math.max(0, top - GAP) };
}

export function rectOf(p: Pick<Placed, "x" | "y" | "w" | "h">, m: Metrics): Rect {
  const top = m.rowTops[p.y] ?? m.height;
  let height = -GAP;
  for (let y = p.y; y < p.y + p.h; y++) height += (m.rowHeights[y] ?? ROW_H) + GAP;
  return { left: p.x * m.colStep, top, width: p.w * m.colStep - GAP, height };
}

const inside = (r: Rect, x: number, y: number) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
const distance = (r: Rect, x: number, y: number) => {
  const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
  const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
  return Math.hypot(dx, dy);
};

/**
 * 끄는 카드를 **어느 순서 자리에** 끼울까 — `others` = 끄는 카드를 뺀 나머지(목록 순서 그대로)와 지금 화면 자리.
 * 포인터가 카드 위면 그 카드의 앞(왼쪽 절반·한 줄 전체 카드는 위쪽 절반) 또는 뒤, 빈 곳이면 가장 가까운 카드 기준, 맨 아래면 끝.
 * 🔑 포인터가 지금 '놓을 자리'(ghost) 안이면 그대로 둔다 — 자리가 바뀌며 카드가 비켜도 포인터 아래가 다시 바뀌어 떨지 않게.
 */
export function insertionIndex(
  others: readonly { id: string; rect: Rect; full: boolean }[],
  pointer: { x: number; y: number },
  ghost: Rect | null,
  current: number | null,
): number {
  if (current !== null && ghost && inside(ghost, pointer.x, pointer.y)) return current;
  if (others.length === 0) return 0;
  const bottom = Math.max(...others.map((o) => o.rect.top + o.rect.height));
  if (pointer.y > bottom) return others.length;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  others.forEach((o, i) => {
    const d = inside(o.rect, pointer.x, pointer.y) ? -1 : distance(o.rect, pointer.x, pointer.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  const r = others[best]!.rect;
  const after = others[best]!.full ? pointer.y > r.top + r.height / 2 : pointer.x > r.left + r.width / 2;
  return after ? best + 1 : best;
}

/** 손잡이로 끈 픽셀 크기 → 격자 크기(열·줄, 소수). 프리셋 고르기는 `nearestPreset`이 한다. */
export function gridSizeFromPixels(widthPx: number, heightPx: number, m: Pick<Metrics, "colStep">): { w: number; h: number } {
  return { w: Math.max(1, (widthPx + GAP) / m.colStep), h: Math.max(1, (heightPx + GAP) / (ROW_H + GAP)) };
}

/** 위·아래 화살표 — 같은 열 근처의 윗줄/아랫줄 카드(그 앞에 끼운다). 없으면 null. */
export function verticalNeighbor(placed: readonly Placed[], id: string, dir: -1 | 1): string | null {
  const me = placed.find((p) => p.id === id);
  if (!me) return null;
  const center = me.x + me.w / 2;
  const candidates = placed.filter((p) => p.id !== id && (dir < 0 ? p.y + p.h <= me.y : p.y >= me.y + me.h));
  if (!candidates.length) return null;
  const row = dir < 0 ? Math.max(...candidates.map((p) => p.y)) : Math.min(...candidates.map((p) => p.y));
  const inRow = candidates.filter((p) => p.y === row);
  inRow.sort((a, b) => Math.abs(a.x + a.w / 2 - center) - Math.abs(b.x + b.w / 2 - center));
  return inRow[0]?.id ?? null;
}
