import { cellKey, mergeRange, rangesIntersect, type Merge, type Pos, type Range, type SheetDoc } from "./doc";

/**
 * 판의 좌표 — 폭·높이가 문서에 **고정값**으로 있어서(글자가 길어도 행이 늘지 않는다) 화면을 재지 않고 계산한다.
 * 선택 테두리·편집 칸·마우스 위치 → 칸 판정이 전부 이 한 벌을 쓴다(그려진 칸과 판정이 갈리지 않게).
 */
export type Layout = {
  /** 열 왼쪽 끝 x — 길이 cols+1(마지막 = 전체 폭). */
  colX: number[];
  /** 행 위쪽 끝 y — 길이 rows+1(마지막 = 전체 높이). */
  rowY: number[];
  width: number;
  height: number;
};

function prefix(sizes: readonly number[]): number[] {
  const out = [0];
  for (const s of sizes) out.push(out[out.length - 1]! + s);
  return out;
}

export function layoutOf(doc: Pick<SheetDoc, "colW" | "rowH">): Layout {
  const colX = prefix(doc.colW);
  const rowY = prefix(doc.rowH);
  return { colX, rowY, width: colX[colX.length - 1]!, height: rowY[rowY.length - 1]! };
}

/** 칸 → 그 칸을 덮는 병합(왼쪽 위 칸 포함). 병합에 안 든 칸은 없다. */
export function mergeIndex(merges: readonly Merge[]): Map<string, Merge> {
  const out = new Map<string, Merge>();
  for (const m of merges) {
    for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) out.set(cellKey(r, c), m);
  }
  return out;
}

export function rectOf(layout: Layout, range: Range): { x: number; y: number; w: number; h: number } {
  const x = layout.colX[range.c0]!;
  const y = layout.rowY[range.r0]!;
  return { x, y, w: layout.colX[range.c1 + 1]! - x, h: layout.rowY[range.r1 + 1]! - y };
}

/** 오름차순 경계 배열에서 v가 든 칸 번호(범위 밖이면 양 끝으로). */
function indexAt(edges: readonly number[], v: number): number {
  const last = edges.length - 2;
  if (v <= 0) return 0;
  if (v >= edges[last + 1]!) return last;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 판 안 좌표(px) → 칸. 판 밖이면 가장 가까운 가장자리 칸. */
export function cellAt(layout: Layout, x: number, y: number): Pos {
  return { r: indexAt(layout.rowY, y), c: indexAt(layout.colX, x) };
}

/** 범위를 병합이 걸치지 않게 넓힌다 — 병합의 일부만 고른 선택은 그 병합 전체로(엑셀 동작). */
export function expandToMerges(range: Range, merges: readonly Merge[]): Range {
  const out = { ...range };
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of merges) {
      const mr = mergeRange(m);
      if (!rangesIntersect(out, mr)) continue;
      if (mr.r0 < out.r0 || mr.c0 < out.c0 || mr.r1 > out.r1 || mr.c1 > out.c1) {
        out.r0 = Math.min(out.r0, mr.r0);
        out.c0 = Math.min(out.c0, mr.c0);
        out.r1 = Math.max(out.r1, mr.r1);
        out.c1 = Math.max(out.c1, mr.c1);
        grew = true;
      }
    }
  }
  return out;
}

/** 한 칸의 실제 범위 — 병합에 들면 그 병합 전체. */
export function cellRange(pos: Pos, index: Map<string, Merge>): Range {
  const m = index.get(cellKey(pos.r, pos.c));
  return m ? mergeRange(m) : { r0: pos.r, c0: pos.c, r1: pos.r, c1: pos.c };
}

/** 칸 이동(방향키·Enter·Tab) — 병합은 한 칸처럼 건너뛴다. 판 끝에서 멈춘다. */
export function stepPos(doc: Pick<SheetDoc, "rows" | "cols">, index: Map<string, Merge>, from: Pos, dr: number, dc: number): Pos {
  const here = cellRange(from, index);
  let r = dr > 0 ? here.r1 + dr : dr < 0 ? here.r0 + dr : from.r;
  let c = dc > 0 ? here.c1 + dc : dc < 0 ? here.c0 + dc : from.c;
  r = Math.min(doc.rows - 1, Math.max(0, r));
  c = Math.min(doc.cols - 1, Math.max(0, c));
  const m = index.get(cellKey(r, c));
  return m ? { r: m.r, c: m.c } : { r, c };
}
