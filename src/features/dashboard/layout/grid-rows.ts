import { positionItems, overlaps, type GridItem } from "./fixed-grid";
import { rowsOf } from "./flow";
import { GRID_COLS, MAX_GRID_Y, MAX_ITEMS, MAX_ROW_SPAN, isSpaceId, type Item } from "./types";

export type RowBand = { y: number; h: number };

/** 모든 열이 비어 있는 연속 구간만 지운다. 부분적으로 빈 칸은 카드 배치이므로 남긴다. */
export function emptyRowBands(items: readonly Item[]): RowBand[] {
  const placed = positionItems(items);
  const occupied = placed.filter((i) => !isSpaceId(i.id));
  const bands: RowBand[] = [];
  for (let y = 0; y < rowsOf(placed); y++) {
    if (occupied.some((i) => i.y <= y && y < i.y + i.h)) continue;
    const last = bands.at(-1);
    if (last && last.y + last.h === y) last.h++;
    else bands.push({ y, h: 1 });
  }
  return bands;
}

/** 카드를 가로지르지 않는 행 경계. 이 위치에 삽입하면 아래 카드를 크기 변경 없이 내린다. */
export function rowBoundaries(items: readonly Item[]): number[] {
  const placed = positionItems(items);
  const cards = placed.filter((i) => !isSpaceId(i.id));
  return Array.from({ length: rowsOf(placed) + 1 }, (_, y) => y)
    .filter((y) => !cards.some((i) => i.y < y && y < i.y + i.h));
}

export function insertGridRows(items: readonly Item[], at: number, count = 1, spaceId = "space:inserted"): Item[] {
  const placed = positionItems(items);
  if (!Number.isInteger(at) || !Number.isInteger(count) || count < 1 || count > MAX_ROW_SPAN || !rowBoundaries(placed).includes(at) || rowsOf(placed) + count > MAX_GRID_Y) return [...items];
  // 예약 칸을 가로지르면 잘라 두고, 실제 빈 공간은 아래 카드 좌표로 유지한다.
  const next = placed.map((i) => i.y >= at ? { ...i, y: i.y + count } : isSpaceId(i.id) && i.y + i.h > at ? { ...i, h: at - i.y } : i).filter((i) => i.h > 0);
  const end = rowsOf(placed) + count;
  if (rowsOf(next) < end) {
    if (next.length >= MAX_ITEMS || !isSpaceId(spaceId) || next.some((i) => i.id === spaceId)) return [...items];
    // 맨 끝의 빈 행도 저장 후 사라지지 않게 예약한다.
    next.push({ id: spaceId, x: 0, y: end - 1, w: GRID_COLS, h: 1 });
  }
  return next;
}

export function removeGridRows(items: readonly Item[], at: number, count: number): Item[] {
  const placed = positionItems(items);
  if (!Number.isInteger(at) || !Number.isInteger(count) || count < 1 || !emptyRowBands(placed).some((b) => b.y <= at && b.y + b.h >= at + count)) return [...items];
  const end = at + count;
  return placed.flatMap((i) => {
    if (i.y >= end) return [{ ...i, y: i.y - count }];
    if (i.y + i.h <= at) return [i];
    // 제거 구간과 겹치는 것은 예약된 빈 행뿐이다.
    const h = i.h - (Math.min(i.y + i.h, end) - Math.max(i.y, at));
    return h > 0 ? [{ ...i, y: Math.min(i.y, at), h }] : [];
  });
}

/** 내용이 긴 카드의 읽기 높이. 저장한 열·폭은 유지하고 실제로 겹친 카드만 아래로 옮긴다. */
export function fitContentRows(items: readonly Item[], heights: Readonly<Record<string, number>>): GridItem[] {
  const placed = positionItems(items);
  const settled: GridItem[] = [];
  for (const item of [...placed].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const measured = heights[item.id];
    const next = { ...item, h: Math.max(item.h, Number.isFinite(measured) ? Math.min(MAX_ROW_SPAN, Math.ceil(measured)) : 0) };
    let collisions;
    while ((collisions = settled.filter((p) => overlaps(p, next))).length) next.y = Math.max(...collisions.map((p) => p.y + p.h));
    settled.push(next);
  }
  const byId = new Map(settled.map((i) => [i.id, i]));
  return placed.map((i) => byId.get(i.id)!);
}
