// "빠진 줄 알았던 학생이 사실은 읽지 못한 자리에 적혀 있는가" — 빠짐을 수강 종료로 쓰기 전의 마지막 확인. 순수.
//
// 🔴 반 칸으로 **읽힌 것만** 보고 빠짐을 정하면 사고다(쓰기 경로 리뷰 재현): 새 열에 강사 이름을 빠뜨렸거나
//    요일을 "수요일"로 적었거나, 옮기면서 글자를 다르게 적었거나, 인원 줄·남의 반 퇴원 줄에 적으면
//    도착지는 못 읽고 **원래 반 수강만 닫힌다**. 그 학생으로 보이는 글자가 탭 어딘가에 남아 있으면 종료로 쓰지 않고 알린다.
//    틀리면 "종료를 안 했다"(알림이 뜨고 앱에서 하면 된다)로 틀리지, "옮기려던 아이의 수강을 닫았다"로 틀리지 않는다.

import { norm } from "../match";
import type { AfterState } from "./delta-after";
import { columnLetter, isCountText, sectionHeadOf, splitStudentText, studentNameOf } from "./grid-text";
import type { ParsedMathGrid, ParsedMeta } from "./types";

export const strayWhy = (where: string) =>
  `이 학생으로 보이는 글자가 ${where}에 적혀 있는데 옮겨 적은 것인지 읽지 못했습니다 — 옮긴 것이면 그 칸을 읽을 수 있게 고치고(강사·요일 머리, 이름·학교·학년 글자, 재원 줄), 아니면 앱에서 수강을 종료해 주세요.`;

/** 길이가 같고 한 글자만 다르다(오타). */
function oneOff(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff += 1;
  return diff === 1;
}

/**
 * (학생, 원래 반) → 그 학생으로 보이는 글자가 읽히지 않은 채 남아 있는 자리("E12"), 없으면 null.
 *
 * "그 학생으로 보인다" = 이름이 같다 · 글자를 낱말로 끊으면 그 이름이 있다(메모를 붙임·한 칸에 두 명·학교를 먼저 적음) ·
 * 이름의 앞부분만 적었다(구분 알파벳을 뺌) · 한 글자만 다르고 학교·학년이 같다(오타).
 * 🔴 글자 통째로 "이름이 들어 있나"를 보지 않는다 — 두 글자 이름("이서")이 남의 이름("이서연") 안에서 걸린다.
 *
 * 남아 있다고 보지 않는 자리:
 *  · 아는 학생으로 읽힌 자리 — 이 학생이면 '이동'으로 잡히고, 다른 학생이면 동명이인이다
 *  · 시트가 아는 **다른** 학생의 글자(퇴원 줄·못 읽은 열에 있어도) — "김지유A"를 뺐는데 "김지유B"가 걸리면 안 된다
 *  · 원래 반의 퇴원 줄(거기로 내린 것은 종료가 맞다)
 *  · 시트를 보낼 때부터 그 학생이 적혀 있던 퇴원 줄(다른 반을 그만둔 기록이지 옮겨 적은 것이 아니다)
 *  · 구역 머리("3명 - 재원생")·인원 숫자
 * 🔴 반 이름 자리의 글자는 빼지 않는다 — 칸 맨 윗줄에 학생 이름을 적으면 그 글자가 '반 이름'으로 읽히는데,
 *    거기를 빼면 그 학생의 원래 반 종료만 남는다.
 */
export function buildStrayFinder(
  grid: ParsedMathGrid,
  meta: ParsedMeta,
  after: AfterState,
  /** 글자 → 시트가 아는 학생 id(모르면 null). */
  knownIdOf: (text: string) => string | null,
): (student: { studentId: string; text: string }, fromKey: string) => string | null {
  const cells = grid.written.flatMap((w) => {
    if (sectionHeadOf(w.text) || isCountText(w.text)) return [];
    const text = splitStudentText(w.text).text;
    const name = studentNameOf(text);
    // 아는 학생으로 읽힌 자리는 처음부터 뺀다.
    const pos = `${w.row}:${w.col}`;
    if (after.readAt.has(pos) && after.readAt.get(pos) !== null) return [];
    const words = text.split(/[\s/(),·[\]]+/).map(norm).filter(Boolean);
    return [{ pos, row: w.row, col: w.col, words, name: norm(name), rest: norm(text.slice(name.length)), known: knownIdOf(text) }];
  });
  /** 대표 반 id → 보낼 때 그 칸 퇴원 줄에 있던 학생. */
  const leftBefore = new Map<string, Set<string>>();
  for (const cell of meta.cells) {
    for (const s of cell.students) {
      if (s.section !== "withdrawn") continue;
      leftBefore.set(cell.primaryClassId, (leftBefore.get(cell.primaryClassId) ?? new Set()).add(s.studentId));
    }
  }
  return (student, fromKey) => {
    const raw = studentNameOf(student.text);
    const name = norm(raw);
    const rest = norm(student.text.slice(raw.length));
    if (!name) return null;
    for (const c of cells) {
      if (c.known && c.known !== student.studentId) continue;
      const looksLike =
        c.name === name ||
        c.words.includes(name) ||
        (name.length >= 3 && c.words.some((w) => w.startsWith(name))) ||
        (c.name.length >= 2 && name.startsWith(c.name) && name.length - c.name.length <= 2) ||
        (oneOff(c.name, name) && c.rest === rest);
      if (!looksLike) continue;
      const left = after.withdrawnAt.get(c.pos);
      if (left && (left.has(fromKey) || [...left].some((key) => leftBefore.get(key)?.has(student.studentId)))) continue;
      return `${columnLetter(c.col)}${c.row + 1}`;
    }
    return null;
  };
}
