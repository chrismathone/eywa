import {
  DEFAULT_COL_W,
  DEFAULT_FONT,
  DEFAULT_FONT_PT,
  DEFAULT_ROW_H,
  cellKey,
  tidyCell,
  type BorderLine,
  type Borders,
  type CellStyle,
  type Merge,
  type SheetDoc,
} from "./doc";

/**
 * 구글 시트 API(`spreadsheets.get` includeGridData) 한 구역 → 판. 침산 영어 시간표 오른쪽 '퇴원생 명단'을
 * **글자·서식 그대로** 옮기는 데 쓴다(원장 2026-10-19 *"텍스트 및 서식은 사진과 동일하게"*).
 * 화면에 보이던 글자(`formattedValue` — 날짜 `7/29`·번호 `1`)를 그대로 넣는다(수식·숫자 서식은 안 옮긴다).
 * 정렬이 없는 숫자 칸은 시트처럼 오른쪽 · 병합 속 칸의 서식은 버리고 왼쪽 위 칸을 쓴다(그리는 쪽 규칙과 같다).
 */

type GColor = { red?: number; green?: number; blue?: number } | undefined;
type GBorder = { style?: string; width?: number; color?: GColor; colorStyle?: { rgbColor?: GColor } };
type GFormat = {
  backgroundColor?: GColor;
  backgroundColorStyle?: { rgbColor?: GColor };
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapStrategy?: string;
  borders?: { top?: GBorder; right?: GBorder; bottom?: GBorder; left?: GBorder };
  textFormat?: {
    foregroundColor?: GColor;
    foregroundColorStyle?: { rgbColor?: GColor };
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
  };
};
export type GoogleCell = { formattedValue?: string; userEnteredValue?: { numberValue?: number }; effectiveFormat?: GFormat };
export type GoogleGrid = {
  rowData?: { values?: GoogleCell[] }[];
  rowMetadata?: { pixelSize?: number }[];
  columnMetadata?: { pixelSize?: number }[];
};
export type GoogleMerge = { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };

/** 시트 절대 좌표의 구역(0부터 · 끝은 포함하지 않는다) — grid는 이 구역의 왼쪽 위부터 읽힌 것. */
export type GoogleArea = { row0: number; col0: number; rows: number; cols: number };

export function googleHex(c: GColor): string {
  const v = (x: number | undefined) => Math.round(Math.min(1, Math.max(0, x ?? 0)) * 255).toString(16).padStart(2, "0");
  return `#${v(c?.red)}${v(c?.green)}${v(c?.blue)}`;
}

function border(b: GBorder | undefined): BorderLine | undefined {
  if (!b?.style || b.style === "NONE") return undefined;
  const c = googleHex(b.colorStyle?.rgbColor ?? b.color);
  if (b.style === "DOUBLE") return { w: 3, c, s: "double" };
  if (b.style === "DASHED") return { w: 1, c, s: "dashed" };
  if (b.style === "DOTTED") return { w: 1, c, s: "dotted" };
  const w = b.style === "SOLID_THICK" ? 3 : b.style === "SOLID_MEDIUM" ? 2 : 1;
  return { w, c, s: "solid" };
}

/** 첫 글꼴 이름만(`arial,sans,sans-serif` → `Arial`). 저장 검증을 못 넘는 이름은 기본 글꼴로. */
function fontName(raw: string | undefined): string | undefined {
  const first = (raw ?? "").split(",")[0]!.trim();
  if (!first) return undefined;
  const name = first.toLowerCase() === "arial" ? DEFAULT_FONT : first;
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return undefined;
  return name === DEFAULT_FONT ? undefined : name;
}

export function styleFromGoogle(cell: GoogleCell | undefined): CellStyle | undefined {
  const f = cell?.effectiveFormat;
  if (!f) return undefined;
  const s: CellStyle = {};
  const bg = googleHex(f.backgroundColorStyle?.rgbColor ?? f.backgroundColor);
  if (f.backgroundColor && bg !== "#ffffff") s.bg = bg;
  const t = f.textFormat;
  const fc = googleHex(t?.foregroundColorStyle?.rgbColor ?? t?.foregroundColor);
  if (fc !== "#000000") s.fc = fc;
  const ff = fontName(t?.fontFamily);
  if (ff) s.ff = ff;
  if (t?.fontSize && t.fontSize !== DEFAULT_FONT_PT) s.fs = t.fontSize;
  if (t?.bold) s.b = true;
  if (t?.italic) s.i = true;
  if (t?.underline) s.u = true;
  if (t?.strikethrough) s.st = true;
  const ha = f.horizontalAlignment;
  if (ha === "CENTER") s.ha = "center";
  else if (ha === "RIGHT") s.ha = "right";
  else if (ha === "LEFT") s.ha = "left";
  else if (cell?.userEnteredValue?.numberValue !== undefined) s.ha = "right";
  if (f.verticalAlignment === "TOP") s.va = "top";
  else if (f.verticalAlignment === "MIDDLE") s.va = "middle";
  if (f.wrapStrategy === "WRAP") s.wr = "wrap";
  else if (f.wrapStrategy === "CLIP") s.wr = "clip";
  const bd: Borders = {};
  const sides = { t: f.borders?.top, r: f.borders?.right, b: f.borders?.bottom, l: f.borders?.left };
  for (const [k, v] of Object.entries(sides) as [keyof Borders, GBorder | undefined][]) {
    const line = border(v);
    if (line) bd[k] = line;
  }
  if (Object.keys(bd).length) s.bd = bd;
  return Object.keys(s).length ? s : undefined;
}

export function docFromGoogle(grid: GoogleGrid, merges: readonly GoogleMerge[], area: GoogleArea): SheetDoc {
  const { row0, col0, rows, cols } = area;
  const colW = Array.from({ length: cols }, (_, j) => grid.columnMetadata?.[j]?.pixelSize ?? DEFAULT_COL_W);
  const rowH = Array.from({ length: rows }, (_, i) => grid.rowMetadata?.[i]?.pixelSize ?? DEFAULT_ROW_H);
  const local: Merge[] = [];
  for (const m of merges) {
    const r = (m.startRowIndex ?? 0) - row0;
    const c = (m.startColumnIndex ?? 0) - col0;
    const rs = (m.endRowIndex ?? 0) - (m.startRowIndex ?? 0);
    const cs = (m.endColumnIndex ?? 0) - (m.startColumnIndex ?? 0);
    // 구역을 걸치는 병합은 버린다(반쪽 병합을 만들지 않는다) — 구역은 명단 바깥 회색 칸에서 끊는다.
    if (r < 0 || c < 0 || r + rs > rows || c + cs > cols || rs * cs < 2) continue;
    local.push({ r, c, rs, cs });
  }
  const covered = new Set<string>();
  for (const m of local) {
    for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) if (r !== m.r || c !== m.c) covered.add(cellKey(r, c));
  }
  const cells: SheetDoc["cells"] = {};
  for (let i = 0; i < rows; i++) {
    const values = grid.rowData?.[i]?.values ?? [];
    for (let j = 0; j < cols; j++) {
      const v = values[j];
      // 병합 속 칸: 테두리만 살린다(병합 덩어리의 오른쪽·아래 변은 가장자리 칸의 선을 그린다).
      if (covered.has(cellKey(i, j))) {
        const bd = styleFromGoogle(v)?.bd;
        const cell = tidyCell({ s: bd ? { bd } : undefined });
        if (cell) cells[cellKey(i, j)] = cell;
        continue;
      }
      const cell = tidyCell({ t: v?.formattedValue || undefined, s: styleFromGoogle(v) });
      if (cell) cells[cellKey(i, j)] = cell;
    }
  }
  return { rows, cols, colW, rowH, cells, merges: local };
}
