import {
  SHEET_LIMITS,
  cellKey,
  cleanText,
  mergeRange,
  rangesIntersect,
  tidyCell,
  type Cell,
  type Merge,
  type Range,
  type SheetDoc,
} from "./doc";
import { liftMergeBorders, mergedTdStyle } from "./merge-borders";
import { ensureSize } from "./ops-struct";
import { sanitizeStyle } from "./pack";
import { cssOfStyle } from "./style-css";

/**
 * 복사·붙여넣기 덩어리 — 판 안에서 옮기면 서식·병합까지, 밖(엑셀·구글 시트·메모장)과는 글자(TSV) + 서식 HTML.
 * 판끼리 복사는 HTML의 `data-aywa-sheet`에 덩어리를 그대로 싣는다(서식이 HTML 변환에서 깎이지 않게).
 */
export type Block = {
  rows: number;
  cols: number;
  /** [행][열] — 빈 칸은 null. */
  cells: (Cell | null)[][];
  /** 덩어리 안 좌표(0부터). */
  merges: Merge[];
};

export function copyBlock(doc: SheetDoc, range: Range): Block {
  const rows = range.r1 - range.r0 + 1;
  const cols = range.c1 - range.c0 + 1;
  const cells = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      const cell = doc.cells[cellKey(range.r0 + i, range.c0 + j)];
      return cell ? structuredClone(cell) : null;
    }),
  );
  const merges = doc.merges
    .filter((m) => rangesIntersect(mergeRange(m), range))
    .map((m) => ({ r: m.r - range.r0, c: m.c - range.c0, rs: m.rs, cs: m.cs }))
    .filter((m) => m.r >= 0 && m.c >= 0 && m.r + m.rs <= rows && m.c + m.cs <= cols);
  return { rows, cols, cells, merges };
}

/**
 * 덩어리를 (r, c)부터 붙인다. `withStyle`=false면 글자만(바깥 글자 붙여넣기 — 대상 칸 서식은 그대로).
 * 서식까지 붙이면 대상 칸을 **통째로 갈아끼운다**(엑셀과 같다 — 빈 칸도 대상 칸을 비운다).
 * 판이 모자라면 키운다(상한 안). 붙는 자리를 걸치는 기존 병합은 푼다.
 */
export function pasteBlock(
  doc: SheetDoc,
  at: { r: number; c: number },
  block: Block,
  withStyle: boolean,
  outsideMerges = false,
): { doc: SheetDoc; range: Range } {
  const rows = Math.min(block.rows, SHEET_LIMITS.rows - at.r);
  const cols = Math.min(block.cols, SHEET_LIMITS.cols - at.c);
  if (rows <= 0 || cols <= 0) return { doc, range: { r0: at.r, c0: at.c, r1: at.r, c1: at.c } };
  const sized = ensureSize(doc, at.r + rows, at.c + cols);
  const range: Range = { r0: at.r, c0: at.c, r1: at.r + rows - 1, c1: at.c + cols - 1 };
  const cells = { ...sized.cells };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = cellKey(at.r + i, at.c + j);
      const src = block.cells[i]?.[j] ?? null;
      const t = src?.t ? cleanText(src.t) : undefined;
      const next = withStyle ? tidyCell(src ? { ...src, t } : undefined) : tidyCell({ ...cells[k], t });
      if (next) cells[k] = next;
      else delete cells[k];
    }
  }
  let merges = sized.merges;
  const added: Merge[] = [];
  if (withStyle) {
    merges = merges.filter((m) => !rangesIntersect(mergeRange(m), range));
    for (const m of block.merges) {
      if (m.r + m.rs > rows || m.c + m.cs > cols) continue;
      added.push({ r: m.r + at.r, c: m.c + at.c, rs: m.rs, cs: m.cs });
    }
    merges = [...merges, ...added];
  }
  // 구글 시트·엑셀에서 붙인 병합 칸은 테두리를 왼쪽 위 칸에만 싣고 온다 — 붙인 병합만 가장자리 칸에 나눠 적는다
  // (판끼리 복사는 덮인 칸이 제 선을 들고 온다 — 다시 나누면 지웠던 선이 되살아난다).
  const next = { ...sized, cells, merges };
  return { doc: outsideMerges ? liftMergeBorders(next, added) : next, range };
}

const needsQuote = (t: string) => /[\t\n\r"]/.test(t);

/** 엑셀·구글 시트가 읽는 TSV(줄바꿈·탭·따옴표가 든 칸은 따옴표로 감싼다). */
export function blockToTsv(block: Block): string {
  return block.cells
    .map((row) => row.map((cell) => {
      const t = cell?.t ?? "";
      return needsQuote(t) ? `"${t.replace(/"/g, '""')}"` : t;
    }).join("\t"))
    .join("\n");
}

/** TSV → 글자 격자. 따옴표 칸(안의 줄바꿈·탭)을 살린다. 끝 빈 줄은 버린다. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i++; continue; }
    if (ch === "\t") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  row.push(field);
  rows.push(row);
  while (rows.length > 1 && rows[rows.length - 1]!.every((v) => v === "")) rows.pop();
  return rows;
}

export function textBlock(grid: string[][]): Block {
  const cols = Math.max(1, ...grid.map((r) => r.length));
  return {
    rows: grid.length,
    cols,
    cells: grid.map((r) => Array.from({ length: cols }, (_, j) => (r[j] ? { t: r[j] } : null))),
    merges: [],
  };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 서식 HTML — 엑셀·구글 시트에 붙여도 색·굵기·병합이 따라간다. 판끼리는 `data-aywa-sheet`의 덩어리를 쓴다. */
export function blockToHtml(block: Block): string {
  const covered = new Set<string>();
  const anchor = new Map<string, Merge>();
  for (const m of block.merges) {
    anchor.set(cellKey(m.r, m.c), m);
    for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) if (r !== m.r || c !== m.c) covered.add(cellKey(r, c));
  }
  const rows = block.cells.map((row, i) => {
    const tds = row.map((cell, j) => {
      if (covered.has(cellKey(i, j))) return "";
      const m = anchor.get(cellKey(i, j));
      const span = m ? `${m.rs > 1 ? ` rowspan="${m.rs}"` : ""}${m.cs > 1 ? ` colspan="${m.cs}"` : ""}` : "";
      const css = cssOfStyle(m ? mergedTdStyle((r, c) => block.cells[r]?.[c] ?? undefined, m) : cell?.s);
      const text = esc(cell?.t ?? "").replace(/\n/g, "<br>");
      return `<td${span}${css ? ` style="${esc(css)}"` : ""}>${text}</td>`;
    });
    return `<tr>${tds.join("")}</tr>`;
  });
  const payload = encodeURIComponent(JSON.stringify(block));
  return `<table data-aywa-sheet="${payload}" style="border-collapse:collapse"><tbody>${rows.join("")}</tbody></table>`;
}

/**
 * 바깥에서 온 덩어리를 저장 가능한 모양으로 — 글자 길이·서식 키·병합 범위를 저장 검증과 같은 기준으로 깎는다.
 * 🔴 붙여넣기 경로는 전부 이걸 지난다(틀린 서식 하나가 이후 자동 저장을 전부 막는다).
 */
export function sanitizeBlock(raw: { rows: number; cols: number; cells: unknown[][]; merges?: unknown[] }): Block {
  const rows = Math.max(1, Math.min(SHEET_LIMITS.rows, Math.floor(raw.rows)));
  const cols = Math.max(1, Math.min(SHEET_LIMITS.cols, Math.floor(raw.cols)));
  const cells = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      const src = raw.cells[i]?.[j] as { t?: unknown; s?: unknown } | null | undefined;
      if (!src || typeof src !== "object") return null;
      const t = typeof src.t === "string" ? cleanText(src.t) : undefined;
      return tidyCell({ t, s: sanitizeStyle(src.s) }) ?? null;
    }),
  );
  const merges: Merge[] = [];
  for (const m of raw.merges ?? []) {
    const { r, c, rs, cs } = (m ?? {}) as Partial<Merge>;
    if (![r, c, rs, cs].every((v) => Number.isInteger(v) && (v as number) >= 0)) continue;
    const mm = { r: r!, c: c!, rs: rs!, cs: cs! };
    if (mm.rs * mm.cs < 2 || mm.r + mm.rs > rows || mm.c + mm.cs > cols) continue;
    if (merges.some((x) => rangesIntersect(mergeRange(x), mergeRange(mm)))) continue;
    merges.push(mm);
  }
  return { rows, cols, cells, merges };
}

/** 판끼리 복사한 HTML이면 덩어리를 꺼낸다(모양이 틀리면 null → 바깥 HTML로 읽는다). */
export function blockFromAywaHtml(html: string): Block | null {
  const m = /data-aywa-sheet="([^"]+)"/.exec(html);
  if (!m) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(m[1]!)) as { rows: number; cols: number; cells: unknown[][]; merges?: unknown[] };
    if (!Array.isArray(raw.cells) || typeof raw.rows !== "number" || typeof raw.cols !== "number") return null;
    return sanitizeBlock(raw);
  } catch {
    return null;
  }
}
