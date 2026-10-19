import { SHEET_LIMITS, DEFAULT_COL_W, DEFAULT_ROW_H, cellKey, type Merge, type SheetDoc } from "./doc";
import { writeSide } from "./merge-borders";

/**
 * 행·열 넣기/빼기·크기 바꾸기 — 칸·병합·크기 배열을 한꺼번에 민다(순수 함수).
 * 🔴 이 판은 시간표와 **따로 논다** — 여기서 행을 넣어도 왼쪽 시간표는 아무 영향이 없다(원장 2026-10-19
 *    *"시간표 영역이랑 우측 엑셀 영역을 구분해서 침범하지 않게"*). 구글 시트에선 같은 격자라 서로 밀렸다.
 */

export type Axis = "row" | "col";

function shiftCells(doc: SheetDoc, axis: Axis, map: (i: number) => number | null): SheetDoc["cells"] {
  const out: SheetDoc["cells"] = {};
  for (const [key, cell] of Object.entries(doc.cells)) {
    const [r, c] = key.split(",").map(Number) as [number, number];
    const next = map(axis === "row" ? r : c);
    if (next === null) continue;
    out[axis === "row" ? `${next},${c}` : `${r},${next}`] = cell;
  }
  return out;
}

const startOf = (m: Merge, axis: Axis) => (axis === "row" ? m.r : m.c);
const spanOf = (m: Merge, axis: Axis) => (axis === "row" ? m.rs : m.cs);
const withAxis = (m: Merge, axis: Axis, start: number, span: number): Merge =>
  axis === "row" ? { ...m, r: start, rs: span } : { ...m, c: start, cs: span };

/** `at` 앞에 n줄 넣기. 넣는 자리를 가로지르는 병합은 그만큼 늘어난다. 새 줄 크기 = 바로 위(왼쪽) 줄. */
export function insertLines(doc: SheetDoc, axis: Axis, at: number, n: number): SheetDoc {
  const count = axis === "row" ? doc.rows : doc.cols;
  const cap = axis === "row" ? SHEET_LIMITS.rows : SHEET_LIMITS.cols;
  const add = Math.min(n, cap - count);
  if (add <= 0 || at < 0 || at > count) return doc;
  const sizes = axis === "row" ? doc.rowH : doc.colW;
  const fill = sizes[at - 1] ?? sizes[at] ?? (axis === "row" ? DEFAULT_ROW_H : DEFAULT_COL_W);
  const nextSizes = [...sizes.slice(0, at), ...Array.from({ length: add }, () => fill), ...sizes.slice(at)];
  const merges = doc.merges.map((m) => {
    const s = startOf(m, axis);
    const span = spanOf(m, axis);
    if (s >= at) return withAxis(m, axis, s + add, span);
    if (s + span > at) return withAxis(m, axis, s, span + add);
    return m;
  });
  const cells = shiftCells(doc, axis, (i) => (i >= at ? i + add : i));
  // 병합 속에 넣은 줄은 덩어리 가장자리 선을 바로 위(왼쪽) 줄에서 이어 받는다 — 안 그러면 그 줄에서 선이 끊긴다(merge-borders.ts).
  for (const m of doc.merges) {
    const s = startOf(m, axis);
    if (!(s < at && s + spanOf(m, axis) > at)) continue;
    for (let i = at; i < at + add; i++) {
      if (axis === "row") {
        writeSide(cells, i, m.c, "l", doc.cells[cellKey(at - 1, m.c)]?.s?.bd?.l);
        writeSide(cells, i, m.c + m.cs - 1, "r", doc.cells[cellKey(at - 1, m.c + m.cs - 1)]?.s?.bd?.r);
      } else {
        writeSide(cells, m.r, i, "t", doc.cells[cellKey(m.r, at - 1)]?.s?.bd?.t);
        writeSide(cells, m.r + m.rs - 1, i, "b", doc.cells[cellKey(m.r + m.rs - 1, at - 1)]?.s?.bd?.b);
      }
    }
  }
  return axis === "row"
    ? { ...doc, rows: count + add, rowH: nextSizes, cells, merges }
    : { ...doc, cols: count + add, colW: nextSizes, cells, merges };
}

/** `at`부터 n줄 지우기. 병합은 지워진 만큼 줄고, 한 칸만 남으면 사라진다. 판은 최소 한 줄은 남는다. */
export function deleteLines(doc: SheetDoc, axis: Axis, at: number, n: number): SheetDoc {
  const count = axis === "row" ? doc.rows : doc.cols;
  const del = Math.min(n, count - at, count - 1);
  if (del <= 0 || at < 0) return doc;
  const end = at + del;
  const sizes = axis === "row" ? doc.rowH : doc.colW;
  const nextSizes = [...sizes.slice(0, at), ...sizes.slice(end)];
  const merges: Merge[] = [];
  for (const m of doc.merges) {
    const s = startOf(m, axis);
    const e = s + spanOf(m, axis);
    const overlap = Math.max(0, Math.min(e, end) - Math.max(s, at));
    const span = e - s - overlap;
    if (span <= 0) continue;
    const start = s < at ? s : s >= end ? s - del : at;
    const next = withAxis(m, axis, start, span);
    if (next.rs * next.cs >= 2) merges.push(next);
  }
  const cells = shiftCells(doc, axis, (i) => (i < at ? i : i >= end ? i - del : null));
  // 병합의 끝 줄(위·아래 또는 왼쪽·오른쪽)을 지우면 그 끝 변을 남은 끝 줄로 옮긴다 — 안 그러면 덩어리의 그 변이 사라진다.
  for (const m of doc.merges) {
    const s = startOf(m, axis);
    const e = s + spanOf(m, axis);
    const lastGone = s < at && e > at && e <= end;
    const firstGone = s >= at && s < end && e > end;
    if (!lastGone && !firstGone) continue;
    const [from, to] = lastGone ? [e - 1, at - 1] : [s, at];
    const side = axis === "row" ? (lastGone ? "b" : "t") : lastGone ? "r" : "l";
    const across = axis === "row" ? m.cs : m.rs;
    for (let k = 0; k < across; k++) {
      const [or, oc, nr, nc] = axis === "row" ? [from, m.c + k, to, m.c + k] : [m.r + k, from, m.r + k, to];
      const line = doc.cells[cellKey(or, oc)]?.s?.bd?.[side];
      if (line) writeSide(cells, nr, nc, side, line);
    }
  }
  return axis === "row"
    ? { ...doc, rows: count - del, rowH: nextSizes, cells, merges }
    : { ...doc, cols: count - del, colW: nextSizes, cells, merges };
}

/** 여러 줄 크기를 한 값으로(머리 경계 끌기 · 여러 줄을 고른 채 끌면 모두 같은 크기 — 엑셀과 같다). */
export function resizeLines(doc: SheetDoc, axis: Axis, lines: readonly number[], px: number): SheetDoc {
  const max = axis === "row" ? SHEET_LIMITS.maxRowH : SHEET_LIMITS.maxColW;
  const v = Math.round(Math.min(max, Math.max(SHEET_LIMITS.minSize, px)));
  const sizes = [...(axis === "row" ? doc.rowH : doc.colW)];
  let changed = false;
  for (const i of lines) {
    if (i >= 0 && i < sizes.length && sizes[i] !== v) {
      sizes[i] = v;
      changed = true;
    }
  }
  if (!changed) return doc;
  return axis === "row" ? { ...doc, rowH: sizes } : { ...doc, colW: sizes };
}

/** 붙여넣기가 판 밖까지 닿으면 그만큼 판을 키운다(상한 안에서). */
export function ensureSize(doc: SheetDoc, rows: number, cols: number): SheetDoc {
  let out = doc;
  if (rows > out.rows) out = insertLines(out, "row", out.rows, rows - out.rows);
  if (cols > out.cols) out = insertLines(out, "col", out.cols, cols - out.cols);
  return out;
}
