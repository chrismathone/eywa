import {
  cellKey,
  cleanText,
  inRange,
  mergeRange,
  rangesIntersect,
  tidyCell,
  type BorderLine,
  type Borders,
  type Cell,
  type CellStyle,
  type Range,
  type SheetDoc,
} from "./doc";
import { expandToMerges } from "./geometry";

/**
 * 판 편집 — 전부 **새 문서를 돌려주는 순수 함수**(되돌리기 이력이 문서 스냅샷을 그대로 쌓는다).
 * 행·열을 넣고 빼는 것은 `ops-struct.ts`.
 */

type CellsMap = SheetDoc["cells"];

function setCell(cells: CellsMap, r: number, c: number, next: Cell | undefined) {
  const k = cellKey(r, c);
  const tidy = tidyCell(next);
  if (tidy) cells[k] = tidy;
  else delete cells[k];
}

function forEachCell(range: Range, fn: (r: number, c: number) => void) {
  for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) fn(r, c);
}

/** 글자 넣기(여러 칸 한 번에 — 붙여넣기·Delete도 이 길). 빈 문자열 = 글자 지움. */
export function setTexts(doc: SheetDoc, entries: readonly { r: number; c: number; t: string }[]): SheetDoc {
  const cells = { ...doc.cells };
  for (const e of entries) {
    if (e.r >= doc.rows || e.c >= doc.cols) continue;
    const prev = cells[cellKey(e.r, e.c)];
    // 저장 검증 상한(칸당 글자 수)에서 자른다 — 넘는 칸 하나가 이후 자동 저장을 전부 막지 않게.
    setCell(cells, e.r, e.c, { ...prev, t: cleanText(e.t) || undefined });
  }
  return { ...doc, cells };
}

/** 서식 고치기 — 키에 null을 주면 그 서식을 지운다(기본값으로). 테두리는 `applyBorders`. */
export type StylePatch = { [K in Exclude<keyof CellStyle, "bd">]?: CellStyle[K] | null };

export function patchStyle(doc: SheetDoc, range: Range, patch: StylePatch): SheetDoc {
  const cells = { ...doc.cells };
  forEachCell(range, (r, c) => {
    const prev = cells[cellKey(r, c)];
    const s: CellStyle = { ...prev?.s };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === false) delete (s as Record<string, unknown>)[k];
      else (s as Record<string, unknown>)[k] = v;
    }
    setCell(cells, r, c, { ...prev, s });
  });
  return { ...doc, cells };
}

/** 서식만 지우기(글자·병합은 그대로). */
export function clearFormats(doc: SheetDoc, range: Range): SheetDoc {
  const cells = { ...doc.cells };
  forEachCell(range, (r, c) => {
    const prev = cells[cellKey(r, c)];
    setCell(cells, r, c, prev ? { t: prev.t } : undefined);
  });
  return { ...doc, cells };
}

export function clearContents(doc: SheetDoc, range: Range): SheetDoc {
  const cells = { ...doc.cells };
  forEachCell(range, (r, c) => {
    const prev = cells[cellKey(r, c)];
    if (prev?.t) setCell(cells, r, c, { s: prev.s });
  });
  return { ...doc, cells };
}

export type BorderMode = "all" | "outer" | "inner" | "horizontal" | "vertical" | "top" | "bottom" | "left" | "right" | "none";

const OPPOSITE = { t: "b", b: "t", l: "r", r: "l" } as const;
type Side = keyof typeof OPPOSITE;

/**
 * 테두리 — 한 변은 양쪽 칸 어느 쪽에 적어도 같은 선이라, **범위 안 칸에 적고 바깥 이웃의 마주 보는 변은 지운다**
 * (안 지우면 두 칸이 다른 색 선을 같은 자리에 들고 있어 어느 쪽이 보일지 그리는 순서가 정한다).
 */
export function applyBorders(doc: SheetDoc, range: Range, mode: BorderMode, line: BorderLine): SheetDoc {
  const cells = { ...doc.cells };
  const edit = (r: number, c: number, side: Side, value: BorderLine | undefined) => {
    if (r < 0 || c < 0 || r >= doc.rows || c >= doc.cols) return;
    const prev = cells[cellKey(r, c)];
    const bd: Borders = { ...prev?.s?.bd };
    if (value) bd[side] = value;
    else delete bd[side];
    const s: CellStyle = { ...prev?.s, bd };
    if (!Object.keys(bd).length) delete s.bd;
    setCell(cells, r, c, { ...prev, s });
  };
  const neighbor = (r: number, c: number, side: Side): [number, number] =>
    side === "t" ? [r - 1, c] : side === "b" ? [r + 1, c] : side === "l" ? [r, c - 1] : [r, c + 1];
  forEachCell(range, (r, c) => {
    const outer = { t: r === range.r0, b: r === range.r1, l: c === range.c0, r: c === range.c1 };
    for (const side of ["t", "r", "b", "l"] as Side[]) {
      const isOuter = outer[side];
      const horizontalEdge = side === "t" || side === "b";
      const want =
        mode === "all" ? true
        : mode === "none" ? false
        : mode === "outer" ? (isOuter ? true : null)
        : mode === "inner" ? (isOuter ? null : true)
        : mode === "horizontal" ? (!isOuter && horizontalEdge ? true : null)
        : mode === "vertical" ? (!isOuter && !horizontalEdge ? true : null)
        : mode === "top" ? (side === "t" && isOuter ? true : null)
        : mode === "bottom" ? (side === "b" && isOuter ? true : null)
        : mode === "left" ? (side === "l" && isOuter ? true : null)
        : side === "r" && isOuter ? true : null;
      if (want === null) continue;
      edit(r, c, side, want ? line : undefined);
      // 마주 보는 변 — 범위 안끼리는 같은 값으로 이미 덮이므로 바깥 이웃만 손본다.
      if (isOuter) {
        const [nr, nc] = neighbor(r, c, side);
        edit(nr, nc, OPPOSITE[side], undefined);
      }
    }
  });
  return { ...doc, cells };
}

/**
 * 병합 — 걸친 병합은 먼저 넓혀 하나로. 글자는 한 칸만 남는다(엑셀과 같다): 왼쪽 위 칸 글자, 그 칸이 비었으면
 * 읽는 순서로 **첫 글자**를 왼쪽 위로 올린다(빈 칸에서 시작한 병합이 글자를 통째로 지우지 않게). 한 칸이면 그대로.
 */
export function mergeCells(doc: SheetDoc, raw: Range): SheetDoc {
  const range = expandToMerges(raw, doc.merges);
  if (range.r0 === range.r1 && range.c0 === range.c1) return doc;
  const merges = doc.merges.filter((m) => !rangesIntersect(mergeRange(m), range));
  merges.push({ r: range.r0, c: range.c0, rs: range.r1 - range.r0 + 1, cs: range.c1 - range.c0 + 1 });
  const cells = { ...doc.cells };
  let keep = cells[cellKey(range.r0, range.c0)]?.t;
  forEachCell(range, (r, c) => {
    if (r === range.r0 && c === range.c0) return;
    const prev = cells[cellKey(r, c)];
    if (!prev?.t) return;
    keep ??= prev.t;
    setCell(cells, r, c, { s: prev.s });
  });
  const anchor = cells[cellKey(range.r0, range.c0)];
  if (keep && anchor?.t !== keep) setCell(cells, range.r0, range.c0, { ...anchor, t: keep });
  return { ...doc, cells, merges };
}

export function unmergeCells(doc: SheetDoc, range: Range): SheetDoc {
  const merges = doc.merges.filter((m) => !rangesIntersect(mergeRange(m), range));
  return merges.length === doc.merges.length ? doc : { ...doc, merges };
}

/** 범위 안에 병합이 하나라도 있나(툴바 '병합 해제' 활성 판정). */
export function hasMergeIn(doc: SheetDoc, range: Range): boolean {
  return doc.merges.some((m) => rangesIntersect(mergeRange(m), range));
}

/** 범위 안 첫 칸(왼쪽 위)의 서식 — 툴바의 '지금 켜져 있나' 표시용. */
export function styleAt(doc: SheetDoc, r: number, c: number): CellStyle {
  return doc.cells[cellKey(r, c)]?.s ?? {};
}

/** 범위가 문서 안에 있는지(붙여넣기·구조 연산 뒤 선택 보정용). */
export function clampRange(doc: Pick<SheetDoc, "rows" | "cols">, range: Range): Range {
  const r = (v: number) => Math.min(doc.rows - 1, Math.max(0, v));
  const c = (v: number) => Math.min(doc.cols - 1, Math.max(0, v));
  return { r0: r(range.r0), c0: c(range.c0), r1: r(range.r1), c1: c(range.c1) };
}

/** 범위 안 칸 중 글자가 있는 칸이 하나라도 있나. */
export function hasTextIn(doc: SheetDoc, range: Range): boolean {
  for (const [k, cell] of Object.entries(doc.cells)) {
    if (!cell.t) continue;
    const [r, c] = k.split(",").map(Number) as [number, number];
    if (inRange(range, r, c)) return true;
  }
  return false;
}
