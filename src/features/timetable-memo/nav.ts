import { cellKey, type Pos, type SheetDoc } from "./doc";

/**
 * Ctrl+방향키 — 엑셀처럼 **글자가 있는 칸의 끝**으로 뛴다. 지금 칸과 다음 칸이 다 차 있으면 그 줄의 마지막 찬 칸,
 * 아니면 다음 찬 칸(없으면 판 끝).
 */
export function jumpPos(doc: Pick<SheetDoc, "rows" | "cols" | "cells">, from: Pos, dr: number, dc: number): Pos {
  const filled = (r: number, c: number) => !!doc.cells[cellKey(r, c)]?.t;
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < doc.rows && c < doc.cols;
  let r = from.r;
  let c = from.c;
  if (!inside(r + dr, c + dc)) return from;
  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
      r += dr;
      c += dc;
    }
    return { r, c };
  }
  r += dr;
  c += dc;
  while (inside(r, c) && !filled(r, c) && inside(r + dr, c + dc)) {
    r += dr;
    c += dc;
  }
  return { r, c };
}
