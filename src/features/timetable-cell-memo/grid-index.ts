import type { DayOfWeek } from "@/features/timetable/lib/periods";

/**
 * 강사뷰 표의 **칸 → (강사 열 · 요일 · 시각)** 계산 — 순수 함수.
 *
 * 🔑 왜 칸마다 속성을 싣지 않나: 강사뷰는 10분 행 × 강사·요일 레인이라 빈 칸이 수천 개다. 칸마다 열·요일·시각을
 *    적으면 전원이 매일 받는 시간표 응답이 그만큼 커진다. 대신 표의 **구조**(행 순서 · rowSpan/colSpan)로
 *    화면 열 번호를 되짚는다(HTML 표 격자 계산과 같다). 서버가 따로 주는 것은 레인 목록 · 첫 행 시각 · 행 간격과,
 *    수업 블록 칸의 **블록 시작 시각**(`data-mb`, 블록 칸에만) 하나다.
 */

export type GridCellShape = { rowSpan: number; colSpan: number };

/** 각 행 각 칸의 **화면 열 번호**(병합 칸이 덮은 자리를 건너 센다). */
export function visualColumns(rows: readonly (readonly GridCellShape[])[]): number[][] {
  const taken: Set<number>[] = rows.map(() => new Set<number>());
  return rows.map((cells, r) => {
    let c = 0;
    return cells.map((cell) => {
      while (taken[r]!.has(c)) c++;
      const start = c;
      const rs = Math.max(1, cell.rowSpan || 1);
      const cs = Math.max(1, cell.colSpan || 1);
      for (let rr = r; rr < Math.min(rows.length, r + rs); rr++) {
        for (let cc = start; cc < start + cs; cc++) taken[rr]!.add(cc);
      }
      c = start + cs;
      return start;
    });
  });
}

/** 화면 열 1번부터의 레인(0번 열은 시각열). 한 칸이 걸친 레인은 언제나 한 강사·한 요일 안이다. */
export type LaneCol = { col: string; day: DayOfWeek };

export type CellPos = { row: number; col: number; rowSpan: number };

export type MemoCellSpec = {
  col: string;
  day: DayOfWeek;
  /** 이 칸이 덮는 시각 [from, to) — 메모를 보일 범위. */
  from: number;
  to: number;
  /** 새 메모를 이 칸에 달 때의 시각 — 수업 블록은 블록 시작, 그 밖은 칸(행) 시작. */
  keyStart: number;
};

/**
 * 칸 하나의 메모 자리. 시각열·모르는 레인이면 null.
 * `blockStart` = 수업 블록 칸의 블록 시작(행 간격과 무관하게 같은 블록에 메모가 붙게 한다).
 */
export function cellSpecOf(
  pos: CellPos,
  blockStart: number | null,
  lanes: readonly LaneCol[],
  axis: { firstMin: number; stepMin: number },
): MemoCellSpec | null {
  const lane = lanes[pos.col - 1];
  if (pos.col < 1 || !lane) return null;
  const from = axis.firstMin + pos.row * axis.stepMin;
  const to = axis.firstMin + (pos.row + Math.max(1, pos.rowSpan)) * axis.stepMin;
  const keyStart = blockStart != null && Number.isFinite(blockStart) ? blockStart : from;
  return { col: lane.col, day: lane.day, from: Math.min(from, keyStart), to: Math.max(to, keyStart + 1), keyStart };
}
