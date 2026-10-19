import { z } from "zod";
import {
  SHEET_LIMITS,
  cellKey,
  mergeRange,
  rangesIntersect,
  tidyCell,
  type CellStyle,
  type Merge,
  type SheetDoc,
} from "./doc";

/**
 * DB 저장 모양(0374a `doc`) — 같은 서식을 `styles`에 **한 번만** 적고 칸은 번호로 가리킨다(침산 판 1,900칸이
 * 서식 60여 벌이라 저장·전송이 수십 배 작아진다). 화면은 늘 `unpack` 결과(칸마다 서식 객체)만 만진다.
 * 🔴 서버 저장 액션이 이 스키마로 검증한다 — 색은 `#rrggbb`만, 글꼴 이름은 글자·공백·하이픈만(인라인 style로 들어간다).
 */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const line = z.object({
  w: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  c: color,
  s: z.enum(["solid", "dashed", "dotted", "double"]),
});
const styleSchema = z
  .object({
    ff: z.string().max(60).regex(/^[\p{L}\p{N} _-]+$/u),
    fs: z.number().min(SHEET_LIMITS.minFontPt).max(SHEET_LIMITS.maxFontPt),
    b: z.boolean(),
    i: z.boolean(),
    u: z.boolean(),
    st: z.boolean(),
    fc: color,
    bg: color,
    ha: z.enum(["left", "center", "right"]),
    va: z.enum(["top", "middle", "bottom"]),
    wr: z.enum(["overflow", "wrap", "clip"]),
    bd: z.object({ t: line, r: line, b: line, l: line }).partial(),
  })
  .partial();

const size = (max: number) => z.number().int().min(SHEET_LIMITS.minSize).max(max);

export const packedSheetSchema = z.object({
  v: z.literal(1),
  rows: z.number().int().min(1).max(SHEET_LIMITS.rows),
  cols: z.number().int().min(1).max(SHEET_LIMITS.cols),
  colW: z.array(size(SHEET_LIMITS.maxColW)).max(SHEET_LIMITS.cols),
  rowH: z.array(size(SHEET_LIMITS.maxRowH)).max(SHEET_LIMITS.rows),
  styles: z.array(styleSchema).max(SHEET_LIMITS.cells),
  cells: z
    .array(z.tuple([z.number().int().min(0), z.number().int().min(0), z.string().max(SHEET_LIMITS.text), z.number().int().min(-1)]))
    .max(SHEET_LIMITS.cells),
  merges: z
    .array(z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(1), z.number().int().min(1)]))
    .max(SHEET_LIMITS.merges),
});
export type PackedSheet = z.infer<typeof packedSheetSchema>;

/** 키 순서와 무관하게 같은 서식이면 같은 문자열(서식 표 중복 제거용). */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
}

export function packSheet(doc: SheetDoc): PackedSheet {
  const styles: CellStyle[] = [];
  const index = new Map<string, number>();
  const cells: PackedSheet["cells"] = [];
  for (const [key, raw] of Object.entries(doc.cells)) {
    const cell = tidyCell(raw);
    if (!cell) continue;
    const [r, c] = key.split(",").map(Number) as [number, number];
    if (!(r < doc.rows && c < doc.cols)) continue;
    let si = -1;
    if (cell.s) {
      const k = canonical(cell.s);
      si = index.get(k) ?? -1;
      if (si < 0) {
        si = styles.length;
        styles.push(cell.s);
        index.set(k, si);
      }
    }
    cells.push([r, c, cell.t ?? "", si]);
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    v: 1,
    rows: doc.rows,
    cols: doc.cols,
    colW: doc.colW.slice(0, doc.cols),
    rowH: doc.rowH.slice(0, doc.rows),
    styles,
    cells,
    merges: doc.merges.map((m) => [m.r, m.c, m.rs, m.cs] as [number, number, number, number]),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 저장 모양 → 화면 모양. 검증을 통과한 값이라도 **모양을 다시 맞춘다** — 범위 밖 칸·서로 겹치는 병합은 버리고,
 * 폭·높이 배열 길이를 행·열 수에 맞춘다(손상된 행 하나가 판 전체를 못 열게 하지 않는다).
 */
export function unpackSheet(packed: PackedSheet, fallbackW: number, fallbackH: number): SheetDoc {
  const { rows, cols } = packed;
  const colW = Array.from({ length: cols }, (_, i) => clamp(packed.colW[i] ?? fallbackW, SHEET_LIMITS.minSize, SHEET_LIMITS.maxColW));
  const rowH = Array.from({ length: rows }, (_, i) => clamp(packed.rowH[i] ?? fallbackH, SHEET_LIMITS.minSize, SHEET_LIMITS.maxRowH));
  const cells: SheetDoc["cells"] = {};
  for (const [r, c, t, si] of packed.cells) {
    if (r >= rows || c >= cols) continue;
    const s = si >= 0 ? packed.styles[si] : undefined;
    const cell = tidyCell({ t: t || undefined, s: s ? { ...s } : undefined });
    if (cell) cells[cellKey(r, c)] = cell;
  }
  const merges: Merge[] = [];
  for (const [r, c, rs, cs] of packed.merges) {
    const m = { r, c, rs, cs };
    if (r + rs > rows || c + cs > cols || rs * cs < 2) continue;
    if (merges.some((x) => rangesIntersect(mergeRange(x), mergeRange(m)))) continue;
    merges.push(m);
  }
  return { rows, cols, colW, rowH, cells, merges };
}

/**
 * 바깥에서 들어온 서식(붙여넣기 HTML·판끼리 복사)을 **저장 검증을 통과하는 키만** 남긴다 — 틀린 값 하나가
 * 섞이면 그 뒤 모든 자동 저장이 서버 검증에서 거절된다.
 */
export function sanitizeStyle(raw: unknown): CellStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, unknown> = {};
  const shape = styleSchema.shape as Record<string, z.ZodTypeAny>;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = shape[k];
    if (!field) continue;
    if (k === "bd" && v && typeof v === "object") {
      const bd: Record<string, unknown> = {};
      for (const [side, lineValue] of Object.entries(v as Record<string, unknown>)) {
        if (["t", "r", "b", "l"].includes(side) && line.safeParse(lineValue).success) bd[side] = lineValue;
      }
      if (Object.keys(bd).length) out.bd = bd;
      continue;
    }
    const parsed = field.safeParse(v);
    if (parsed.success && parsed.data !== undefined) out[k] = parsed.data;
  }
  return Object.keys(out).length ? (out as CellStyle) : undefined;
}

/** 검증 + 펼침. 모양이 틀리면 null(호출부가 '읽지 못함'으로 다룬다). */
export function parsePackedSheet(raw: unknown, fallbackW: number, fallbackH: number): SheetDoc | null {
  const parsed = packedSheetSchema.safeParse(raw);
  return parsed.success ? unpackSheet(parsed.data, fallbackW, fallbackH) : null;
}
