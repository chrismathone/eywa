// 격자의 뼈대 — 열(강사·요일)과 교시 블록(행 범위)을 머리 행·교시 라벨에서 읽는다. 순수.
//
// 익스포터 배치: 1행 합계 · 2행 요일 묶음 · 3행 강사 · 4행 요일, 5행부터 교시 블록(블록마다 24행).
// A열과 (주말이 있으면) 둘째 '교시' 열에 "2교시⏎16:20~18:10"이 블록 전체로 병합돼 있다.

import { KO_DAYS, columnLetter, type MergeAt } from "./grid-text";
import type { GridBlock, GridColumn } from "./types";

export const HEADER_ROWS = 4;
const TEACHER_ROW = 2;
const DAY_ROW = 3;
const PERIOD_HEAD = "교시";
/** 병합 정보가 없을 때의 블록 높이(익스포터 GROUP_ROWS). */
const DEFAULT_BLOCK_ROWS = 24;

export interface GridLayout {
  columns: GridColumn[];
  blocks: GridBlock[];
  warnings: string[];
}

export function parseLayout(cells: string[][], mergeAt: MergeAt): GridLayout {
  const at = (r: number, c: number) => (cells[r]?.[c] ?? "").trim();
  /** 병합된 칸이면 왼쪽 위 칸의 글자 — 강사 이름은 그 강사의 요일 열 전체에 병합돼 있다. */
  const anchor = (r: number, c: number) => {
    const own = at(r, c);
    if (own) return own;
    const m = mergeAt(r, c);
    return m ? at(m.startRowIndex, m.startColumnIndex) : "";
  };

  if (at(TEACHER_ROW, 0) !== PERIOD_HEAD) {
    throw new Error(
      "시간표 탭의 머리 행을 찾지 못했습니다(3행 A열이 '교시'가 아님). 위쪽 행을 지우거나 끼웠다면 시간표에서 시트로 다시 보낸 뒤 고쳐 주세요.",
    );
  }

  const width = Math.max(0, ...cells.map((row) => row.length));
  const periodCols: number[] = [];
  for (let c = 0; c < width; c++) if (at(TEACHER_ROW, c) === PERIOD_HEAD) periodCols.push(c);
  const weekendPeriodCol = periodCols.find((c) => c > 0) ?? null;

  const warnings: string[] = [];
  const columns: GridColumn[] = [];
  for (let c = 1; c < width; c++) {
    if (periodCols.includes(c)) continue;
    const day = at(DAY_ROW, c).split("\n")[0]!.trim();
    const teacher = anchor(TEACHER_ROW, c);
    if (!KO_DAYS.includes(day)) {
      // 요일이 없는 열 — 머리가 통째로 비었으면 그냥 빈 열이고, 강사만 적혀 있으면 사람이 알아야 한다.
      if (teacher || day) {
        warnings.push(`${columnLetter(c)}열: 요일 칸을 읽지 못했습니다(${day || "비어 있음"}) — 이 열은 읽지 않았습니다.`);
      }
      continue;
    }
    if (!teacher) {
      warnings.push(`${columnLetter(c)}열(${day}): 강사 이름 칸이 비어 있습니다 — 이 열은 읽지 않았습니다.`);
      continue;
    }
    // 평일 구역과 주말 구역은 교시 시각이 다르다 — 요일이 구역과 어긋난 열은 엉뚱한 시각으로 읽힌다.
    const weekend = weekendPeriodCol != null && c > weekendPeriodCol;
    if (weekend !== (day === "토" || day === "일")) {
      warnings.push(
        `${columnLetter(c)}열(${day}): ${weekend ? "평일 요일이 주말 구역에" : "주말 요일이 평일 구역에"} 놓여 있습니다 — 이 열은 읽지 않았습니다.`,
      );
      continue;
    }
    columns.push({ col: c, teacher, day, weekend });
  }

  // 교시 블록 — 평일·주말 라벨 열 어느 쪽에든 "N교시"가 있으면 그 행이 블록의 첫 행이다.
  const found = new Map<number, { gid: number; endHint: number | null }>();
  for (let r = HEADER_ROWS; r < cells.length; r++) {
    for (const pc of periodCols) {
      const m = /^(\d+)\s*교시/.exec(at(r, pc));
      if (!m) continue;
      // 라벨 칸은 블록 전체에 병합돼 있다 — 행을 끼워 넣어도 병합이 함께 늘어나므로 끝을 여기서 읽는다.
      const merge = mergeAt(r, pc);
      const endHint = merge && merge.startRowIndex === r ? merge.endRowIndex - 1 : null;
      const prev = found.get(r);
      found.set(r, { gid: Number(m[1]), endHint: prev?.endHint ?? endHint });
    }
  }
  const starts = [...found.keys()].sort((a, b) => a - b);
  const blocks: GridBlock[] = starts.map((start, i) => {
    const info = found.get(start)!;
    const next = starts[i + 1];
    const end = info.endHint ?? (next != null ? next - 1 : start + DEFAULT_BLOCK_ROWS - 1);
    return { start, end, gid: info.gid };
  });
  if (blocks.length === 0) {
    throw new Error(
      "교시 라벨(예: '2교시')을 찾지 못했습니다. 교시 열을 지웠다면 시간표에서 시트로 다시 보낸 뒤 고쳐 주세요.",
    );
  }

  return { columns, blocks, warnings };
}
