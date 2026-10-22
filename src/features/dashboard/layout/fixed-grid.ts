import { pack, rowsOf } from "./flow";
import { GRID_COLS, MAX_GRID_Y, MAX_ITEMS, MAX_ROW_SPAN, isHeadingId, isKpiId, isSpaceId, type Item, type Placed } from "./types";

export type GridItem = Item & { x: number; y: number };
const integer = (v: number | undefined, fallback: number, max: number, min = 0) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v!))) : fallback;
export const isPositioned = (i: Item): i is GridItem => Number.isFinite(i.x) && Number.isFinite(i.y);
export const overlaps = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function gridBounds(i: Item): GridItem {
  const w = integer(i.w, 6, GRID_COLS, 1);
  const h = integer(i.h, 4, MAX_ROW_SPAN, 1);
  return { ...i, w, h, x: integer(i.x, 0, GRID_COLS - w), y: integer(i.y, 0, MAX_GRID_Y - h) };
}

/** 이전 크기의 한 줄 → 고정 높이 격자. 작은 숫자 카드는 두 칸, 내용 카드는 네 칸. */
export const gridHeight = (i: Pick<Item, "id" | "mode" | "h">) =>
  isHeadingId(i.id) ? 1 : isSpaceId(i.id) ? 4 : i.h * (isKpiId(i.id) || i.mode === "summary" ? 2 : 4);

/** 예전 순서 배치는 한 번만 좌표로 변환한다. 이미 저장된 빈칸·행·열은 압축하지 않는다. */
export function positionItems(items: readonly Item[]): GridItem[] {
  if (!items.length) return [];
  if (items.some(isPositioned)) {
    const out: GridItem[] = [];
    for (const i of items) out.push(isPositioned(i) ? gridBounds(i) : gridBounds({ ...i, h: gridHeight(i), x: 0, y: rowsOf(out) }));
    return out;
  }
  // 좌표가 없던 배치의 숫자 카드 띠는 독립 행이다. 작은 카드 네 장 뒤에 큰 패널이 올라오지 않게 한다.
  const old: Placed[] = [];
  let batch: Item[] = [];
  const flush = () => { const y = rowsOf(old); old.push(...pack(batch).map((p) => ({ ...p, y: p.y + y }))); batch = []; };
  for (const i of items) {
    if (batch.length && isKpiId(batch.at(-1)!.id) && !isKpiId(i.id)) flush();
    batch.push(i);
  }
  flush();
  const heights = Array.from({ length: rowsOf(old) }, (_, y) => {
    const row = old.filter((p) => p.y <= y && p.y + p.h > y);
    return Math.max(1, ...row.map((p) => gridHeight({ ...items.find((i) => i.id === p.id)!, h: 1 })));
  });
  const top = (y: number) => heights.slice(0, y).reduce((n, h) => n + h, 0);
  return items.map((i, idx) => gridBounds({ ...i, x: old[idx].x, y: top(old[idx].y), h: gridHeight(i) }));
}

/** 우선 배치 뒤 겹친 카드만 이동한다. 이동은 오른쪽 우선, 크기 변경은 같은 열 아래쪽 우선이다. */
function settleItems(base: readonly GridItem[], fixed: readonly GridItem[], direction: "right" | "down"): Item[] | null {
  const fixedIds = new Set(fixed.map((i) => i.id));
  const rest = base.filter((i) => !fixedIds.has(i.id));
  const settled = [...fixed];
  for (const i of [...rest].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let next = { ...i };
    if (isSpaceId(i.id) && settled.some((p) => overlaps(p, next))) continue;
    for (;;) {
      const collisions = settled.filter((p) => overlaps(p, next));
      if (!collisions.length) break;
      const right = Math.max(...collisions.map((p) => p.x + p.w));
      if (direction === "right" && right + next.w <= GRID_COLS) {
        next = { ...next, x: right };
      } else if (direction === "right") {
        // 한 줄에 더 들어가지 않을 때만 줄을 넘긴다. 새 줄은 왼쪽부터 이어 놓는다.
        const row = settled.filter((p) => p.y < next.y + next.h && p.y + p.h > next.y);
        next = { ...next, x: 0, y: Math.max(...row.map((p) => p.y + p.h)) };
      } else {
        next = { ...next, y: Math.max(...collisions.map((p) => p.y + p.h)) };
      }
      // 경계에 닿으면 전체 조작을 취소한다. 겹친 상태를 저장하지 않는다.
      if (next.y + next.h > MAX_GRID_Y) return null;
    }
    settled.push(next);
  }
  const byId = new Map(settled.map((i) => [i.id, i]));
  const order = [...base, ...fixed.filter((i) => !base.some((b) => b.id === i.id))];
  return order.flatMap((i) => byId.has(i.id) ? [byId.get(i.id)!] : []);
}

/** 카드를 끼워 넣으면 기존 카드는 오른쪽으로 밀리고, 줄이 꽉 차면 다음 줄로 이어진다. */
export function placeItem(items: readonly Item[], item: Item, x: number, y: number, direction: "right" | "down" = "right"): Item[] {
  const base = positionItems(items);
  if (!base.some((i) => i.id === item.id) && base.length >= MAX_ITEMS) return [...items];
  const moving = gridBounds({ ...item, x, y, h: isPositioned(item) ? item.h : gridHeight(item) });
  return settleItems(base, [moving], direction) ?? [...items];
}

export type KpiWidth = 2 | 3 | 6;

/** KPI를 읽기 순서대로 같은 폭·높이로 정렬한다. 아래 구역의 간격·크기·옵션은 보존한다. */
export function uniformKpiItems(items: readonly Item[], width: KpiWidth): Item[] {
  const base = positionItems(items);
  const kpis = base.filter((i) => isKpiId(i.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!kpis.length) return [...items];
  const top = kpis[0].y;
  const oldEnd = rowsOf(kpis);
  const perRow = GRID_COLS / width;
  const end = top + Math.ceil(kpis.length / perRow) * 2;
  if (end > MAX_GRID_Y) return [...items];
  const fixed = kpis.map((i, n) => ({ ...i, x: (n % perRow) * width, y: top + Math.floor(n / perRow) * 2, w: width, h: 2 }));
  const separate = base.every((i) => isKpiId(i.id) || isSpaceId(i.id) || i.y + i.h <= top || i.y >= oldEnd);
  const shifted = base.map((i) => separate && !isKpiId(i.id) && i.y >= oldEnd ? { ...i, y: i.y + end - oldEnd } : i);
  if (shifted.some((i) => i.y + i.h > MAX_GRID_Y)) return [...items];
  return settleItems(shifted, fixed, "down") ?? [...items];
}

export function appendItem(items: readonly Item[], item: Item): Item[] {
  const base = positionItems(items);
  const space = base.find((i) => isSpaceId(i.id));
  return placeItem(base, item, space?.x ?? 0, space?.y ?? rowsOf(base));
}

export function addRow(items: readonly Item[], id: string): Item[] {
  const base = positionItems(items);
  if (base.length >= MAX_ITEMS || rowsOf(base) + 4 > MAX_GRID_Y) return [...items];
  return [...base, { id: `space:${id}`, x: 0, y: rowsOf(base), w: GRID_COLS, h: 4 }];
}

export function resizeGridItem(items: readonly Item[], id: string, size: Pick<Item, "w" | "h" | "mode">): Item[] {
  const base = positionItems(items);
  const item = base.find((i) => i.id === id);
  if (!item) return [...items];
  // 오른쪽 경계를 넘는 확장은 왼쪽 위치를 바꾸지 않고 가능한 폭까지만 허용한다.
  return placeItem(base, { ...item, ...size, w: Math.min(size.w, GRID_COLS - item.x), h: Math.min(size.h, MAX_GRID_Y - item.y) }, item.x, item.y, "down");
}
