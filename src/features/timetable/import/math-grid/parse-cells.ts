// 격자 탭 전체 읽기 — 뼈대(열·교시 블록)를 세우고 평일·주말 구역의 반 칸을 모은다. 순수.

import { norm } from "../match";
import type { GridCtx } from "./cell-tools";
import { buildMergeLookup } from "./grid-text";
import { parseLayout } from "./parse-layout";
import { readWeekdayCells } from "./parse-weekday";
import { readWeekendCells } from "./parse-weekend";
import type { MathGridInput, ParsedMathGrid } from "./types";

export function parseMathGrid(
  input: MathGridInput,
  opts?: {
    /** 등록된 강의실 이름 — 손으로 만든 칸에서 이름 바로 아래 줄을 강의실로 알아보는 데만 쓴다(없어도 읽는다). */
    roomNames?: string[];
    /** 시트가 알던 학생의 글자·이름(내보내기 기록) — 강의실 줄 자리에 적힌 학생을 알아보는 데만 쓴다. */
    studentTexts?: string[];
  },
): ParsedMathGrid {
  const { cells } = input;
  const mergeAt = buildMergeLookup(input.merges);
  const { columns, blocks, warnings } = parseLayout(cells, mergeAt);
  const rooms = new Set((opts?.roomNames ?? []).map(norm));
  const studentTexts = new Set((opts?.studentTexts ?? []).map(norm));
  const ctx: GridCtx = {
    at: (r, c) => (cells[r]?.[c] ?? "").trim(),
    mergeAt,
    columns,
    byCol: new Map(columns.map((c) => [c.col, c])),
    blocks,
    warnings,
    isRoomName: (text) => rooms.has(norm(text)),
    isStudentText: (text) => studentTexts.has(norm(text)),
  };
  return { columns, blocks, cells: [...readWeekdayCells(ctx), ...readWeekendCells(ctx)], warnings };
}
