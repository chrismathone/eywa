import type { Lesson } from './model';

/** Connected overlap groups share a column width; touching endpoints do not overlap. */
export function overlapLayout(items: Lesson[]) {
  const result = new Map<string, { left: number; width: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  let group: { item: Lesson; lane: number }[] = [], ends: number[] = [], end = -1;
  const flush = () => { for (const { item, lane } of group) result.set(item.id, { left: lane * 100 / ends.length, width: 100 / ends.length }); };
  for (const item of sorted) {
    if (item.start >= end) { flush(); group = []; ends = []; end = -1; }
    let lane = ends.findIndex(value => value <= item.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.end; end = Math.max(end, item.end); group.push({ item, lane });
  }
  flush(); return result;
}
