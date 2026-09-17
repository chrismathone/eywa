/**
 * 학생 주간 격자 **행 높이** — 순수(Vitest). 칸 내용(반·담당/자리·방)이 들어가게 최소 높이를 정하고,
 * 과목 탭 카드 높이를 맞출 때만 남는 세로를 나눠 준다(2026-07-08 탭 높이 고정은 유지).
 *
 * 옛 값 `46px × 행수`는 v5 전 xs=12px 격자용이라, xs=14px 세 줄(반+담당+방)이 옆·아래 칸으로 흘렀다
 * (원장 2026-09-17 신지민 영어 주간표). 행마다 같은 높이로 나누지 않고 **그 행이 보여주는 줄 수**로 잰다.
 * 연속 교시 병합(rowSpan)은 높이를 나눠 갖고, 비어 있는 교시는 시간 라벨만 들어갈 만큼.
 */
import type { PeriodCell, PeriodGridRow, SubjectPeriodGrid } from "./week-grid";

/** v5 `--text-xs` 14 · 본문 leading 1.45 · 반 이름 `leading-tight` 1.25. */
const XS = 14;
const LINE = Math.ceil(XS * 1.45); // 21
const LINE_TIGHT = Math.ceil(XS * 1.25); // 18
const GAP = 2; // mt-0.5 / pt-0.5
const PAD_Y = 8; // td `p-1` · 안쪽 `py-1`
const SEAT_H = LINE + 2; // 알약 1px 테두리 × 2
const BUFFER = 4; // 서브픽셀 · border-collapse

/** 요일 칸 폭 — `student-period-grid` colgroup과 같은 값(줄바꿈 추정 폭). */
export const CELL_COL_W = 104;
const CELL_INNER_W = CELL_COL_W - PAD_Y - 12; // td pad + inner px-1.5

/**
 * 칸 폭을 넘는 글이 몇 줄이 되는지. 한글 1em·그 외 ~0.57em으로 재고 폭을 넘기면 다음 줄.
 * 화면의 `break-keep`보다 줄을 많이 잡을 수 있다(높이가 남는 쪽). 빈 문자열은 0.
 */
export function estimateWrapLines(text: string, widthPx = CELL_INNER_W): number {
  if (!text) return 0;
  let lineW = 0;
  let lines = 1;
  for (const ch of text) {
    const w = /[\u1100-\uD7AF\u3000-\u9FFF]/.test(ch) ? XS : ch === " " ? 4 : 8;
    if (lineW + w > widthPx && lineW > 0) {
      lines += 1;
      lineW = w;
    } else {
      lineW += w;
    }
  }
  return lines;
}

/** 수업 칸 총높이(td 패딩 포함) — 반 이름 + 담당/자리 + 강의실. */
export function cellBlockHeight(cell: PeriodCell): number {
  const nameH = Math.max(1, estimateWrapLines(cell.className)) * LINE_TIGHT;
  let inner = PAD_Y + nameH;
  if (cell.seat) inner += GAP + SEAT_H;
  else if (cell.teacherName) inner += GAP + Math.max(1, estimateWrapLines(cell.teacherName)) * LINE;
  if (cell.room) inner += GAP + Math.max(1, estimateWrapLines(cell.room)) * LINE;
  return PAD_Y + inner + BUFFER;
}

/** 교시 라벨 칸 — 이름+시간 두 줄, 이름을 비우면 시간만. */
export function labelBlockHeight(row: PeriodGridRow): number {
  return row.label ? PAD_Y + LINE + GAP + LINE + BUFFER : PAD_Y + LINE + BUFFER;
}

export function sumSpan(heights: readonly number[], start: number, span: number): number {
  let h = 0;
  for (let i = 0; i < span; i++) h += heights[start + i] ?? 0;
  return h;
}

function stretchTo(heights: number[], fillTotal?: number): number[] {
  if (fillTotal == null || heights.length === 0) return heights;
  const sum = heights.reduce((a, b) => a + b, 0);
  if (fillTotal <= sum) return heights;
  const extra = fillTotal - sum;
  const n = heights.length;
  const base = Math.floor(extra / n);
  const rem = extra - base * n;
  return heights.map((h, i) => h + base + (i >= n - rem ? 1 : 0));
}

/**
 * 행별 픽셀 높이. 칸 내용 최소 ≥ 교시 라벨 최소, 병합 칸은 높이를 나눠 갖는다.
 * `fillTotal`이 그보다 크면(다른 과목 탭과 카드 높이를 맞출 때) 행에 균등 분배 — **줄이지는 않는다**.
 */
export function periodRowHeightsForGrid(grid: SubjectPeriodGrid, fillTotal?: number): number[] {
  const n = grid.rows.length;
  if (n === 0) return [];
  const heights = grid.rows.map((row) => labelBlockHeight(row));
  for (let ri = 0; ri < n; ri++) {
    for (let ci = 0; ci < grid.days.length; ci++) {
      const block = grid.blocks.get(`${ri}:${ci}`);
      if (!block) continue;
      const cell = grid.cellAt(ri, ci);
      if (!cell) continue;
      const per = Math.ceil(cellBlockHeight(cell) / block.rowSpan);
      for (let k = 0; k < block.rowSpan; k++) {
        const i = ri + k;
        if (i < n) heights[i] = Math.max(heights[i]!, per);
      }
    }
  }
  return stretchTo(heights, fillTotal);
}

export function tableContentHeight(grid: SubjectPeriodGrid): number {
  return periodRowHeightsForGrid(grid).reduce((a, b) => a + b, 0);
}
