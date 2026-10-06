// 반 칸을 읽는 공용 도구 — 평일·주말 읽기가 같은 규칙으로 가로 범위·학생 줄·구역을 판정한다. 순수.

import { isCountText, sectionHeadOf, splitStudentText, type MergeAt } from "./grid-text";
import type { GridBlock, GridColumn, GridSection, GridStudentCell } from "./types";

export interface GridCtx {
  at: (row: number, col: number) => string;
  mergeAt: MergeAt;
  columns: GridColumn[];
  byCol: Map<number, GridColumn>;
  blocks: GridBlock[];
  warnings: string[];
  /** 등록된 강의실 이름인가 — 손으로 만든 칸에서 이름 바로 아래 줄이 둘째 반인지 강의실인지 가른다. */
  isRoomName: (text: string) => boolean;
  /** 시트가 알던 학생의 글자·이름인가 — 강의실 줄 자리에 이름만 적은 학생을 강의실로 삼키지 않는다. */
  isStudentText: (text: string) => boolean;
}

/** 반 이름으로 볼 수 있는 글자 — 구역 머리·인원 숫자는 아니다. */
export const nameLike = (text: string) => text !== "" && !sectionHeadOf(text) && !isCountText(text);

/** "이름/학교" 꼴(빗금 양옆이 붙어 있다). 합반 강의실 줄 "본원603 / 본원204"는 빗금 양옆이 떨어져 있다. */
export const looksLikeStudent = (text: string) => /\S\/\S/.test(text) && !text.includes(" / ");

/**
 * 이름 칸의 가로 병합이 덮는 열 전부. 🔴 머리를 못 읽은 열(요일을 안 적은 끼운 열 등)에서 **끊지 않는다** —
 * 끊으면 그 오른쪽 요일에만 오는 학생이 통째로 안 읽혀 '빠짐'이 된다. 요일을 모르는 열은 요일 없이 싣는다.
 */
export function spanOf(ctx: GridCtx, row: number, first: GridColumn): GridColumn[] {
  const merge = ctx.mergeAt(row, first.col);
  const last = merge ? merge.endColumnIndex - 1 : first.col;
  const span = [first];
  for (let c = first.col + 1; c <= last; c++) {
    span.push(ctx.byCol.get(c) ?? { col: c, teacher: first.teacher, day: "", weekend: first.weekend });
  }
  return span;
}

export const daysOf = (span: GridColumn[]) => span.map((s) => s.day).filter(Boolean);

/**
 * 강의실로 **확실한** 글자 — 등록된 강의실 이름이거나, 합반 강의실 줄("A / B")의 조각이 전부 등록된 이름.
 * 🔴 " / "만 보고 강의실로 단정하지 말 것 — 사람은 학생도 "이두리 / 5옥산초"로 적는다(조용히 버려지면 '빠짐'만 남는다).
 */
const roomText = (ctx: GridCtx, text: string) =>
  ctx.isRoomName(text) || (text.includes(" / ") && text.split(" / ").every((part) => ctx.isRoomName(part.trim())));

/** 학생 줄 하나 — 병합된 줄은 칸 요일 전부, 한 열짜리는 그 요일만(분리등원). */
function studentsInRow(ctx: GridCtx, row: number, span: GridColumn[], section: GridSection): GridStudentCell[] {
  const out: GridStudentCell[] = [];
  for (const column of span) {
    const raw = ctx.at(row, column.col);
    if (!raw || sectionHeadOf(raw) || isCountText(raw) || roomText(ctx, raw)) continue;
    const merge = ctx.mergeAt(row, column.col);
    const covered = merge ? span.filter((s) => s.col >= merge.startColumnIndex && s.col < merge.endColumnIndex) : [column];
    out.push({ ...splitStudentText(raw), days: daysOf(covered), section, row, col: column.col });
  }
  return out;
}

/**
 * 이름 줄 아래(강의실·구역 머리·학생)를 읽는다. `from`은 이름 칸 바로 다음 줄(익스포터의 강의실 줄)이다.
 *
 * 강의실 판정(학생을 하나도 읽기 전까지): 빗금 꼴("이름/학교")이면 학생 · 등록된 강의실 이름이거나 합반 강의실 줄
 * ("A / B")이면 강의실 · 어느 쪽도 아니면 **`from` 줄이거나 바로 아래가 재원 머리일 때만** 강의실이다(익스포터는
 * 강의실 줄 바로 아래에 "N명 - 재원생"을 적는다 — 이름과 강의실 사이에 행이 끼어 한 줄 밀려도 알아본다).
 *
 * 구역은 "N명 - 대기/퇴원" 머리를 만나면 바뀐다. 🔴 **자리(몇 번째 줄)로 구역을 정하지 않는다** — 재원 14줄이
 * 꽉 찬 반에 한 명을 더 적으면 그 글자는 비어 있던 대기 머리 줄에 놓이고, 손으로 만든 칸은 재원 머리 줄 없이
 * 강의실 바로 아래부터 학생이 온다. 자리로 읽으면 그 학생들이 조용히 버려진다.
 */
export function readBody(
  ctx: GridCtx,
  span: GridColumn[],
  from: number,
  to: number,
  opts: {
    /** 이름 바로 아래 줄에서 이미 찾은 강의실(손으로 만든 칸). 있으면 `from` 줄도 학생 줄이다. */
    room: string | null;
    /** 머리가 없어도 퇴원으로 보는 줄(평일 블록의 맨 아래 한 줄 — 퇴원 머리는 학생이 없으면 글자 없이 검은 칸만 남는다). */
    withdrawnRow?: number;
  },
): { room: string; students: GridStudentCell[] } {
  let room = opts.room;
  let section: GridSection = "active";
  const students: GridStudentCell[] = [];
  for (let r = from; r <= to; r++) {
    const head = span.map((s) => sectionHeadOf(ctx.at(r, s.col))).find(Boolean);
    if (head) {
      section = head;
      continue;
    }
    if (room == null && students.length === 0) {
      const text = ctx.at(r, span[0]!.col);
      const atRoomRow = r === from || sectionHeadOf(ctx.at(r + 1, span[0]!.col)) === "active";
      const studentish = looksLikeStudent(text) || ctx.isStudentText(text);
      const roomish = roomText(ctx, text) || (atRoomRow && !studentish);
      if (text !== "" && roomish) {
        room = text;
        continue;
      }
    }
    students.push(...studentsInRow(ctx, r, span, r === opts.withdrawnRow ? "withdrawn" : section));
  }
  return { room: room ?? "", students };
}
