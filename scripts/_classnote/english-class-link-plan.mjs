// scripts/_classnote/english-class-link-plan.mjs — 영어 반 ↔ ClassNote 영어 반 방 **짝 제안**(순수, Vitest).
//
// 보드 이름이 aywa 반 이름과 달라(`중등E_초6 MED a` ↔ `Jennifer 초6 MED a (화수금)`) 이름으로 잇지 않는다.
// 그 반 학생의 확정 원아(0185a)가 **가장 많이 들어 있는 반 방**을 제안하고, 몇 명 중 몇 명이 들어 있는지 함께 낸다.
// 사람이 확인한 것만 s2_0006 표에 넣는다(link-english-class-boards.mjs).

/** 1인 보드(`(영어)이름`·`(수학)이름`)와 전체 공지 방은 반 방 후보가 아니다. */
export const isGroupBoardName = (name) => {
  const n = String(name ?? "").trim();
  return !!n && !/^\(\s*(수학|영어)\s*\)/.test(n) && !/^\[ALL\]/i.test(n);
};

/**
 * @param {{
 *   classes: Array<{ classId: string, className: string, studentIds: string[] }>,
 *   childrenOf: Map<string, number[]>,          // 학생 → 확정 원아(0185a)
 *   boards: Array<{ boardId: number, boardName: string }>,
 *   membersOf: Map<number, Set<number>>,        // 반 방 → 원아(스냅샷 0142a)
 *   excludeBoardIds?: Set<number>,              // 수학 반 보드(0302a) 등 후보에서 뺄 방
 * }} a
 * @returns {Array<{ classId: string, className: string, students: number, linked: number,
 *   status: "clean"|"partial"|"tie"|"none", boardId: number|null, boardName: string|null, inBoard: number,
 *   missing: string[], noLink: string[], runnerUp: { boardName: string, inBoard: number } | null }>}
 *   missing = 원아는 있는데 그 방에 없는 학생 id · noLink = 확정 원아가 없는 학생 id
 */
export function planEnglishClassLinks({ classes, childrenOf, boards, membersOf, excludeBoardIds = new Set() }) {
  const candidates = boards.filter((b) => isGroupBoardName(b.boardName) && !excludeBoardIds.has(Number(b.boardId)));
  return classes.map((c) => {
    const noLink = c.studentIds.filter((s) => !(childrenOf.get(s) ?? []).length);
    const linkedIds = c.studentIds.filter((s) => (childrenOf.get(s) ?? []).length);
    const inOf = (boardId) => {
      const mem = membersOf.get(Number(boardId)) ?? new Set();
      return linkedIds.filter((s) => (childrenOf.get(s) ?? []).some((ch) => mem.has(Number(ch))));
    };
    const scored = candidates
      .map((b) => ({ b, ins: inOf(b.boardId) }))
      .filter((x) => x.ins.length)
      .sort((x, y) => y.ins.length - x.ins.length || String(x.b.boardName).localeCompare(String(y.b.boardName), "ko"));
    const base = { classId: c.classId, className: c.className, students: c.studentIds.length, linked: linkedIds.length, noLink };
    if (!scored.length)
      return { ...base, status: "none", boardId: null, boardName: null, inBoard: 0, missing: linkedIds, runnerUp: null };
    const [top, second] = scored;
    const runnerUp = second ? { boardName: second.b.boardName, inBoard: second.ins.length } : null;
    const inSet = new Set(top.ins);
    const missing = linkedIds.filter((s) => !inSet.has(s));
    // 같은 수가 둘이면 고르지 않는다 — 사람이 정한다.
    if (second && second.ins.length === top.ins.length)
      return { ...base, status: "tie", boardId: null, boardName: null, inBoard: top.ins.length, missing, runnerUp };
    return {
      ...base,
      status: missing.length ? "partial" : "clean",
      boardId: Number(top.b.boardId),
      boardName: top.b.boardName,
      inBoard: top.ins.length,
      missing,
      runnerUp,
    };
  });
}
