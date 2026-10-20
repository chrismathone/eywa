/**
 * 시간표 메모 시트 — 영어 시간표 오른쪽에 붙는 **엑셀 판**의 문서 모양(원장 2026-10-19 *"그냥 엑셀창처럼 해주고
 * 커스텀해서 이것저것 모든 서식 입력할 수 있게"*). 지점 × 과목 한 장(0374a `timetable_memo_sheets`).
 *
 * 화면이 쥐는 모양은 이것(칸마다 서식 객체)이고, DB에는 같은 서식을 한 번만 적는 접은 모양(`pack.ts`)으로 간다.
 * 🔴 순수 모듈 — 서버·클라 양쪽이 쓴다(`"use client"`·`server-only` 금지, [[#61]]·[[#81]]).
 * 🔴 칸 글자는 **글자 그대로**다(수식·숫자 서식 없음) — 구글 시트에서 옮길 때도 화면에 보이던 글자를 넣는다.
 */

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
/** overflow = 옆 칸이 비면 글자가 넘쳐 보인다(구글 시트·엑셀 기본) · wrap = 줄바꿈 · clip = 칸 안에서 자른다. */
export type Wrap = "overflow" | "wrap" | "clip";
export type LineStyle = "solid" | "dashed" | "dotted" | "double";
export type BorderLine = { w: 1 | 2 | 3; c: string; s: LineStyle };
export type Borders = { t?: BorderLine; r?: BorderLine; b?: BorderLine; l?: BorderLine };

/** 칸 서식 — 없는 키는 기본값(Arial 10pt · 검정 · 흰 바탕 · 왼쪽·아래 · 넘침 · 테두리 없음). */
export type CellStyle = {
  ff?: string;
  fs?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  st?: boolean;
  fc?: string;
  bg?: string;
  ha?: HAlign;
  va?: VAlign;
  wr?: Wrap;
  bd?: Borders;
};
export type Cell = { t?: string; s?: CellStyle };
/** 병합 — (r, c)가 왼쪽 위 칸, rs×cs 칸을 덮는다. 0부터 센다. */
export type Merge = { r: number; c: number; rs: number; cs: number };

export type SheetDoc = {
  rows: number;
  cols: number;
  /** 열 폭(px) — 길이 = cols. */
  colW: number[];
  /** 행 높이(px) — 길이 = rows. */
  rowH: number[];
  /** `"r,c"` → 칸. 글자도 서식도 없는 칸은 키 자체가 없다. */
  cells: Record<string, Cell>;
  merges: Merge[];
};

export type Pos = { r: number; c: number };
/** 닫힌 구간(r0..r1 · c0..c1 모두 포함). 늘 r0 ≤ r1 · c0 ≤ c1. */
export type Range = { r0: number; c0: number; r1: number; c1: number };

export const DEFAULT_COL_W = 80;
export const DEFAULT_ROW_H = 25;
export const DEFAULT_FONT = "Arial";
export const DEFAULT_FONT_PT = 10;
/** 새 지점(빈 판)의 처음 크기 — 엑셀 첫 화면처럼 A~Z × 100행. */
export const EMPTY_ROWS = 100;
export const EMPTY_COLS = 26;

/** 저장·붙여넣기 상한 — 비정상 입력이 DB·화면을 불리지 않게(서버 검증과 같은 값). */
export const SHEET_LIMITS = {
  rows: 1000,
  cols: 200,
  text: 5000,
  cells: 60000,
  merges: 5000,
  minSize: 6,
  maxColW: 1200,
  maxRowH: 600,
  minFontPt: 6,
  maxFontPt: 72,
} as const;

/**
 * 편집 결과가 저장 상한(칸 수·병합 수)을 넘는지 — 넘는 편집은 화면에서 **들이지 않는다**(서버는 문서 통째로
 * 거절하므로 한 번 넘으면 그 뒤 자동 저장이 전부 실패한다). 넘으면 사람이 읽을 이유, 아니면 null.
 */
export function overLimit(doc: Pick<SheetDoc, "cells" | "merges">): string | null {
  if (Object.keys(doc.cells).length > SHEET_LIMITS.cells) return `칸이 너무 많습니다(최대 ${SHEET_LIMITS.cells.toLocaleString()}칸). 더 작은 범위로 나눠 주세요.`;
  if (doc.merges.length > SHEET_LIMITS.merges) return `병합이 너무 많습니다(최대 ${SHEET_LIMITS.merges.toLocaleString()}개).`;
  return null;
}

/** 지금 이 판을 다는 과목 — 영어 시간표만(원장 요청 범위). 넓히려면 여기와 시간표 화면 조건을 함께. */
export const MEMO_SHEET_SUBJECTS = ["english"] as const;
export type MemoSheetSubject = (typeof MEMO_SHEET_SUBJECTS)[number];
export function isMemoSheetSubject(s: string): s is MemoSheetSubject {
  return (MEMO_SHEET_SUBJECTS as readonly string[]).includes(s);
}

export const cellKey = (r: number, c: number): string => `${r},${c}`;

/**
 * 칸 글자를 저장할 수 있는 모양으로 — 짝 없는 서로게이트(반쪽 이모지)는 `�`로, 상한에서 자를 때 이모지를 반으로
 * 쪼개지 않는다. 🔴 반쪽 글자가 남으면 DB(jsonb)가 문서 통째로 거절해 그 뒤 자동 저장이 전부 실패한다.
 */
export function cleanText(t: string, max: number = SHEET_LIMITS.text): string {
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    let piece: string;
    if (isHigh && i + 1 < t.length && t.charCodeAt(i + 1) >= 0xdc00 && t.charCodeAt(i + 1) <= 0xdfff) {
      piece = t.slice(i, i + 2);
      i++;
    } else piece = isHigh || isLow ? "�" : t[i]!;
    if (out.length + piece.length > max) break;
    out += piece;
  }
  return out;
}

/** 0 → A · 25 → Z · 26 → AA (엑셀 열 이름). */
export function colName(c: number): string {
  let n = c + 1;
  let out = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 칸 주소 `A1`. */
export const cellName = (p: Pos): string => `${colName(p.c)}${p.r + 1}`;

export function emptyDoc(rows: number = EMPTY_ROWS, cols: number = EMPTY_COLS): SheetDoc {
  return {
    rows,
    cols,
    colW: Array.from({ length: cols }, () => DEFAULT_COL_W),
    rowH: Array.from({ length: rows }, () => DEFAULT_ROW_H),
    cells: {},
    merges: [],
  };
}

export function rangeOf(a: Pos, b: Pos): Range {
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}

export function inRange(range: Range, r: number, c: number): boolean {
  return r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
}

export function mergeRange(m: Merge): Range {
  return { r0: m.r, c0: m.c, r1: m.r + m.rs - 1, c1: m.c + m.cs - 1 };
}

export function rangesIntersect(a: Range, b: Range): boolean {
  return a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;
}

/** 서식이 비었는지(키가 하나도 없거나 테두리만 빈 객체). */
export function isEmptyStyle(s: CellStyle | undefined): boolean {
  if (!s) return true;
  return Object.entries(s).every(([k, v]) =>
    v === undefined || (k === "bd" && (!v || Object.values(v as Borders).every((x) => !x))),
  );
}

/** 칸을 정리한다 — 빈 글자·빈 서식은 키째 뺀다(저장 크기·비교 안정). 둘 다 비면 undefined. */
export function tidyCell(cell: Cell | undefined): Cell | undefined {
  if (!cell) return undefined;
  const out: Cell = {};
  if (cell.t) out.t = cell.t;
  if (!isEmptyStyle(cell.s)) out.s = cell.s;
  return out.t === undefined && out.s === undefined ? undefined : out;
}
