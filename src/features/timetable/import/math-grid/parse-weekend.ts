// 주말 구역 — 열마다 위에서 아래로 훑어 반 칸을 읽는다. 순수.
//
// 익스포터 배치(weekendLayout): 1시간 슬롯(12행)을 세로로 이어 한 칸을 만들고, 대기·퇴원 구역은 학생이 있을 때만
// 생긴다. 칸의 **마지막 행이 인원 숫자**이고, 수업이 없는 슬롯은 12행이 통째로 병합된 빈 칸이다.
//
// 🔴 "블록 높이의 절반"·"12행마다" 같은 자리 계산으로 칸의 시작을 찾지 말 것 — 사람이 학생 줄을 하나 끼우면
//    그 아래 칸이 전부 한 줄씩 밀려, 칸이 통째로 안 읽히거나 아래 칸을 삼킨다(리뷰 재현: 거짓 '빠짐' 5건).
//    칸은 내용으로 찾는다: 시작 = 반 이름, 끝 = 인원 숫자.

import { daysOf, looksLikeStudent, nameLike, readBody, spanOf, type GridCtx } from "./cell-tools";
import { LEGACY_PERIOD_IDS, isCountText, splitClassNames } from "./grid-text";
import type { GridClassCell } from "./types";

/** 주말 1시간 슬롯의 행 수(익스포터 SLOT_ROWS). */
const SLOT_ROWS = 12;

export function readWeekendCells(ctx: GridCtx): GridClassCell[] {
  const out: GridClassCell[] = [];
  const bodyStart = ctx.blocks[0]!.start;
  const bodyEnd = ctx.blocks[ctx.blocks.length - 1]!.end;

  /** 그 행이 몇 번째 1시간 슬롯인가 — 교시 블록의 앞 절반이면 첫 슬롯, 뒤 절반이면 둘째(행이 조금 밀려도 반올림). */
  const slotOf = (row: number) => {
    const block = [...ctx.blocks].reverse().find((b) => row >= b.start) ?? ctx.blocks[0]!;
    return (block.gid - 1) * 2 + Math.min(1, Math.round((row - block.start) / SLOT_ROWS));
  };
  /** 통째로 병합된 빈 칸이면 그 다음 행, 아니면 null. */
  const emptyCellEnd = (row: number, col: number) => {
    const m = ctx.mergeAt(row, col);
    return !ctx.at(row, col) && m && m.startRowIndex === row && m.endRowIndex - row > 2 ? m.endRowIndex : null;
  };
  /**
   * 병합된 이름 칸의 끝 다음 행(익스포터는 이름을 두 줄 병합으로 적는다 — 그 안에 행이 끼면 세 줄). 아니면 null.
   * 🔴 더 큰 병합(12행짜리 빈 슬롯)에 든 글자를 이름으로 받지 말 것 — 익스포터가 1시간 칸에 대기·퇴원 줄을 넘치게
   *    그리면 다음 빈 슬롯의 첫 칸에 퇴원 학생 글자가 남고, 그것이 '새 반'으로 읽힌다.
   */
  const nameMergeEnd = (row: number, col: number) => {
    const m = ctx.mergeAt(row, col);
    const height = m && m.startRowIndex === row ? m.endRowIndex - row : 0;
    return nameLike(ctx.at(row, col)) && (height === 2 || height === 3) ? m!.endRowIndex : null;
  };

  const taken = new Set<string>();
  for (const column of ctx.columns.filter((c) => c.weekend)) {
    let row = bodyStart;
    while (row <= bodyEnd) {
      const skipTo = taken.has(`${row}:${column.col}`) ? row + 1 : emptyCellEnd(row, column.col);
      if (skipTo != null) {
        row = skipTo;
        continue;
      }
      const head = ctx.at(row, column.col);
      const nameEnd = nameMergeEnd(row, column.col);
      if (!nameLike(head) || (nameEnd == null && looksLikeStudent(head))) {
        row += 1;
        continue;
      }

      const span = spanOf(ctx, row, column);
      const bodyFrom = Math.max(row + 2, nameEnd ?? 0);
      // 칸의 끝 = 처음 만나는 인원 숫자. 🔴 강의실 줄은 건너뛰고 찾는다 — 강의실 이름이 "603"처럼 숫자뿐이면
      //    그 줄이 인원 줄로 읽혀 칸이 거기서 끝나고, 손대지 않은 반의 학생 전원이 '빠짐'이 된다.
      // 그 전에 다른 칸(빈 칸·이름 칸)이 시작하면 인원 줄이 없는 칸이다.
      let countRow: number | null = null;
      let limit = bodyEnd;
      for (let q = bodyFrom + 1; q <= bodyEnd; q++) {
        if (isCountText(ctx.at(q, column.col))) {
          countRow = q;
          break;
        }
        if (emptyCellEnd(q, column.col) != null || nameMergeEnd(q, column.col) != null) {
          limit = q - 1;
          break;
        }
      }
      // 인원 줄이 없으면(손으로 만든 칸) **마지막 글자 줄까지** 읽는다. 🔴 한 슬롯(12행)에서 자르지 말 것 — 그 아래에
      //    적은 학생이 조용히 버려져 원래 반 '빠짐'만 남는다. 맨 아래까지 늘이지도 않는다(하루 종일 수업이 된다).
      let end = countRow ?? row + 1;
      if (countRow == null) {
        for (let q = limit; q > row; q--) {
          if (span.some((s) => ctx.at(q, s.col) !== "")) {
            end = q;
            break;
          }
        }
      }
      // 행이 한 줄 끼어 13행이 돼도 한 슬롯이다(반올림), 14행을 넘기면 다음 슬롯까지 쓴 것으로 본다.
      const slotCount = Math.max(1, Math.round((end - row + 1) / SLOT_ROWS + 0.3));
      const first = slotOf(row);
      const periodIds = LEGACY_PERIOD_IDS.slice(first, first + slotCount);

      for (const s of span) for (let r = row; r <= end; r++) taken.add(`${r}:${s.col}`);

      const below = nameEnd != null ? "" : ctx.at(row + 1, column.col);
      const body = readBody(ctx, span, bodyFrom, countRow != null ? end - 1 : end, {
        room: below && ctx.isRoomName(below) ? below : null,
      });
      out.push({
        classes: splitClassNames(head).map((name) => ({ name, periodIds })),
        room: body.room,
        teacher: column.teacher,
        days: daysOf(span),
        weekend: true,
        students: body.students,
        row,
        col: column.col,
      });
      row = end + 1;
    }
  }
  return out;
}
