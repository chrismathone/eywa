// 평일 구역 — 교시 블록마다 왼쪽 열부터 반 칸을 읽는다. 순수.
//
// 익스포터 배치(weekdayLayout): 이름 2행 · 강의실 1 · 재원 머리 1 · 재원 … · 대기 머리 1 · 대기 2 · 퇴원 머리 1 ·
// 퇴원 1 · 인원 1. 이름 두 줄이 한 칸으로 병합돼 있으면 교시 전체, 따로면 윗줄 = 앞 시간 · 아랫줄 = 뒤 시간이다.

import { daysOf, nameLike, readBody, spanOf, type GridCtx } from "./cell-tools";
import { splitClassNames } from "./grid-text";
import type { GridCellClass, GridClassCell } from "./types";

/** 이름 2 + 강의실 1 + 인원 1에 학생 줄이 조금은 있어야 칸이다. */
const MIN_BLOCK_ROWS = 6;

export function readWeekdayCells(ctx: GridCtx): GridClassCell[] {
  const out: GridClassCell[] = [];
  const weekdayCols = ctx.columns.filter((c) => !c.weekend);
  for (const block of ctx.blocks) {
    if (block.end - block.start + 1 < MIN_BLOCK_ROWS) {
      ctx.warnings.push(`${block.gid}교시 블록의 행 수가 너무 적어 읽지 못했습니다.`);
      continue;
    }
    const first = `${block.gid}-1`;
    const second = `${block.gid}-2`;

    let coveredUntil = -1;
    for (const column of weekdayCols) {
      if (column.col <= coveredUntil) continue;
      const nameMerge = ctx.mergeAt(block.start, column.col);
      const whole = !!nameMerge && nameMerge.endRowIndex > block.start + 1;
      const top = ctx.at(block.start, column.col);
      let bot = whole ? "" : ctx.at(block.start + 1, column.col);
      // 손으로 만든 칸은 이름 바로 아래에 강의실을 적기도 한다 — 등록된 강의실 이름이면 둘째 반이 아니다.
      let room: string | null = null;
      if (top && bot && ctx.isRoomName(bot)) {
        room = bot;
        bot = "";
      }
      const topNames = nameLike(top) ? splitClassNames(top) : [];
      const botNames = nameLike(bot) ? splitClassNames(bot) : [];
      if (topNames.length === 0 && botNames.length === 0) continue;

      const span = spanOf(ctx, topNames.length ? block.start : block.start + 1, column);
      coveredUntil = span[span.length - 1]!.col;

      const classes: GridCellClass[] = [...new Set([...topNames, ...botNames])].map((name) => ({
        name,
        periodIds: whole
          ? [first, second]
          : [...(topNames.includes(name) ? [first] : []), ...(botNames.includes(name) ? [second] : [])],
        ...(!whole && botNames.length === 0 ? { loneTop: true } : {}),
      }));

      // 이름 칸 다음 줄(강의실)부터 인원 줄 앞까지 — 이름 병합 안에 행이 끼어 있으면 병합이 끝난 줄부터다.
      // 맨 아래 한 줄은 머리가 없어도 퇴원이다.
      const bodyFrom = Math.max(block.start + 2, whole ? nameMerge!.endRowIndex : 0);
      const body = readBody(ctx, span, bodyFrom, block.end - 1, { room, withdrawnRow: block.end - 1 });
      out.push({
        classes,
        room: body.room,
        teacher: column.teacher,
        days: daysOf(span),
        weekend: false,
        students: body.students,
        row: block.start,
        col: column.col,
      });
    }
  }
  return out;
}
