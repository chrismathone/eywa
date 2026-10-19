import { DEFAULT_COL_W, DEFAULT_FONT_PT, cellKey, type CellStyle, type SheetDoc } from "./doc";
import { mergeIndex } from "./geometry";
import { resizeLines, type Axis } from "./ops-struct";

/**
 * 열·행 크기 맞추기 — 머리줄 경계를 **두 번 누르면** 내용에 맞춘다(원장 2026-10-19 *"엑셀처럼 열 더블클릭하면 크기 정렬"*).
 * · 열 = 그 열에서 가장 긴 줄의 글자 폭 + 칸 안 여백. 줄바꿈 칸도 줄마다 잰다(엑셀·구글 시트와 같다).
 * · 행 = 그 행에서 가장 높은 칸 — 글자 크기 × 줄 수(줄바꿈 칸은 칸 폭에서 접어 센다).
 * · 여러 칸에 걸친 병합은 열 맞추기에서 빼고(폭을 어느 열 몫으로 셀지 모른다), 여러 행 병합은 행 맞추기에서 뺀다(엑셀과 같다).
 * · 글자가 하나도 없는 열은 기본 폭(80px), 행은 기본 글꼴 한 줄 높이(21px — 구글 시트 기본 행과 같다)로 돌아간다.
 * · 덮인 칸(병합 속)의 글자는 세지 않는다 — 화면에 안 보이는 글자가 칸을 키우지 않게.
 * 글자 폭은 그리는 쪽이 재서 넘긴다(`measure` — 화면은 canvas, 테스트는 가짜).
 */
export type Measure = (text: string, style: CellStyle | undefined) => number;

/** 글자 층의 칸 안 여백(grid-base `px-[3px] py-[2px]`) + 격자선 1px + 잘림을 막는 여유. */
const PAD_X = 6 + 1 + 3;
/** 줄바꿈 칸에서 글자가 쓰는 폭 = 칸 폭 − 좌우 여백(글자 층과 같은 값). */
const TEXT_INSET = 6;
/** 한 줄에 들어갈 수 있는 글자 수의 상한(가장 넓은 열에서도 넘지 않는다) — 띄어쓰기 없는 긴 글에서 남은 글 전체를 매번 재지 않게. */
const MAX_FIT = 1000;
const PAD_Y = 4 + 1;
const LINE_HEIGHT = 1.15;
const ptToPx = (pt: number) => (pt * 4) / 3;
const lineHeightPx = (s: CellStyle | undefined) => ptToPx(s?.fs ?? DEFAULT_FONT_PT) * LINE_HEIGHT;
/** 글자 없는 행의 높이 = 기본 글꼴 한 줄(구글 시트 기본 21px과 같은 값). */
const ONE_LINE_ROW = Math.ceil(lineHeightPx(undefined) + PAD_Y);

/** 칸 폭 안에서 접힌 줄 수 — 띄어쓰기에서 접고, 한 낱말이 칸보다 길면 글자 단위로 자른다(`overflow-wrap:anywhere`). */
export function wrappedLineCount(text: string, width: number, s: CellStyle | undefined, measure: Measure): number {
  let count = 0;
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (!line || measure(next, s) <= width) {
        line = next;
      } else {
        count++;
        line = word.trimStart();
      }
      while (line.length > 1 && measure(line.slice(0, MAX_FIT + 1), s) > width) {
        // 칸에 들어가는 가장 긴 앞부분(이분 탐색 — 긴 낱말에서 글자마다 재지 않게). 한 글자도 안 들어가면 한 글자씩.
        let lo = 1;
        let hi = Math.min(line.length - 1, MAX_FIT);
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (measure(line.slice(0, mid), s) <= width) lo = mid;
          else hi = mid - 1;
        }
        count++;
        line = line.slice(lo);
      }
    }
    count++;
  }
  return Math.max(1, count);
}

/** 고른 줄들을 내용에 맞춘 새 문서(바뀐 것이 없으면 받은 문서 그대로). */
export function autoFitLines(doc: SheetDoc, axis: Axis, lines: readonly number[], measure: Measure): SheetDoc {
  const want = new Set(lines);
  const merged = mergeIndex(doc.merges);
  const best = new Map<number, number>();
  for (const [key, cell] of Object.entries(doc.cells)) {
    if (!cell.t) continue;
    const [r, c] = key.split(",").map(Number) as [number, number];
    const line = axis === "col" ? c : r;
    if (!want.has(line) || r >= doc.rows || c >= doc.cols) continue;
    const m = merged.get(cellKey(r, c));
    if (m && (m.r !== r || m.c !== c)) continue;
    if (m && (axis === "col" ? m.cs > 1 : m.rs > 1)) continue;
    let size: number;
    if (axis === "col") {
      size = Math.max(...cell.t.split("\n").map((t) => measure(t, cell.s))) + PAD_X;
    } else {
      const span = m ? m.cs : 1;
      let width = -TEXT_INSET;
      for (let j = c; j < c + span; j++) width += doc.colW[j] ?? DEFAULT_COL_W;
      const count = cell.s?.wr === "wrap" ? wrappedLineCount(cell.t, Math.max(1, width), cell.s, measure) : cell.t.split("\n").length;
      size = count * lineHeightPx(cell.s) + PAD_Y;
    }
    best.set(line, Math.max(best.get(line) ?? 0, size));
  }
  let out = doc;
  for (const i of want) {
    const fitted = best.get(i);
    const size = fitted === undefined ? (axis === "col" ? DEFAULT_COL_W : ONE_LINE_ROW) : Math.ceil(axis === "row" ? Math.max(fitted, ONE_LINE_ROW) : fitted);
    out = resizeLines(out, axis, [i], size);
  }
  return out;
}
