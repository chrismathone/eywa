// 격자 칸 글자 해석 — 익스포터(exports/math-timetable/exporter.ts)가 쓰는 표기를 거꾸로 읽는다. 순수.

import type { SheetGridMerge } from "../structure/types";
import type { GridSection } from "./types";

export const KO_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

/** 익스포터의 레거시 교시 축 — 1교시 = 1-1 + 1-2. */
export const LEGACY_PERIOD_IDS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"];

const SECTION_HEAD = /^\d+\s*명\s*-\s*(재원생|대기|퇴원)$/;
const SECTION_OF: Record<string, GridSection> = { 재원생: "active", 대기: "hold", 퇴원: "withdrawn" };
const CLASS_PREFIX = /^\[(\d+)\]\s*/;

/** "3명 - 재원생" 같은 구역 머리면 그 구역, 아니면 null. */
export function sectionHeadOf(text: string): GridSection | null {
  const m = SECTION_HEAD.exec(text.trim());
  return m ? SECTION_OF[m[1]!]! : null;
}

/** 인원 합계 칸(숫자만). */
export function isCountText(text: string): boolean {
  return /^\d+$/.test(text.trim());
}

/** 반 이름 칸 → 반 이름들. 합반은 "[1] A⏎[2] B"로 적힌다. */
export function splitClassNames(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(CLASS_PREFIX, "").trim())
    .filter(Boolean);
}

/** 학생 칸 → 합반 번호 + 본문. "[2] 윤종윤/1칠성고" → { classIdx: 2, text: "윤종윤/1칠성고" } */
export function splitStudentText(raw: string): { classIdx: number; text: string } {
  // 빗금 양옆 공백은 없앤다 — 사람이 "이두리 / 5옥산초"로 적어도 시트가 알던 "이두리/5옥산초"와 같은 학생이다.
  const t = raw.trim().replace(/\s*\/\s*/g, "/");
  const m = CLASS_PREFIX.exec(t);
  return m ? { classIdx: Number(m[1]), text: t.slice(m[0].length).trim() } : { classIdx: 0, text: t };
}

/** "추윤서/6옥산초" → "추윤서". 빗금이 없으면 통째로 이름이다. */
export function studentNameOf(text: string): string {
  const i = text.lastIndexOf("/");
  return (i < 0 ? text : text.slice(0, i)).trim();
}

/** 0-based 열 번호 → 시트 열 글자(38 → "AM"). 안내 문구용. */
export function columnLetter(col: number): string {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export type MergeAt = (row: number, col: number) => SheetGridMerge | undefined;

/** (행,열) → 그 칸을 덮는 병합. 격자 전체가 수천 칸이라 칸마다 미리 적어 둔다. */
export function buildMergeLookup(merges: SheetGridMerge[]): MergeAt {
  const byCell = new Map<number, SheetGridMerge>();
  for (const m of merges) {
    for (let r = m.startRowIndex; r < m.endRowIndex; r++) {
      for (let c = m.startColumnIndex; c < m.endColumnIndex; c++) byCell.set(r * 100_000 + c, m);
    }
  }
  return (row, col) => byCell.get(row * 100_000 + col);
}
