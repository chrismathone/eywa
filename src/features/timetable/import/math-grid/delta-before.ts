// "시트가 알고 있던 명단" — 내보내기 기록(`_meta`)에서 반 → 학생들을 세운다. 순수(delta.ts의 재료).
//
// 합반 칸의 둘째 반 이상은 기록에 대표 반 id만 남는다 → 지금 격자의 같은 칸을 찾아 이름 줄에서 반을 되찾는다.
// 같은 대표 반이 짝이 다른 칸 둘에 설 수 있다(월요일엔 Q와, 수요일엔 R과) — 첫 칸으로 찍으면 학생이 엉뚱한 반이 된다.

import type { ClassHit, GridRefs } from "./delta-refs";
import type { GridClassCell, MetaCell, ParsedMeta } from "./types";

export interface ResolvedCell {
  cell: GridClassCell;
  /** 칸의 반들을 푼 결과(이름이 모호하면 null). */
  hits: (ClassHit | null)[];
  texts: Set<string>;
}

export interface BeforeState {
  /** 반 id → 학생 id → 글자·그 반 칸들에 적힌 횟수·전부 대기 구역이었는지. */
  rosters: Map<string, Map<string, { text: string; count: number; held: boolean }>>;
  /** 명단을 믿을 수 없는 반(비교 키) — 그 반의 빠짐·추가는 내지 않는다. */
  skipKeys: Set<string>;
  /** 어느 반이었는지 되찾지 못한 학생 — 다른 반의 '추가'로 읽지 않는다. */
  orphanIds: Set<string>;
}

const byCol = <T extends { col: number }>(list: T[]) => [...list].sort((a, b) => a.col - b.col);

export function buildBefore(
  meta: ParsedMeta,
  resolved: ResolvedCell[],
  refs: GridRefs,
  warn: (text: string) => void,
): BeforeState {
  const rosters: BeforeState["rosters"] = new Map();
  const skipKeys = new Set<string>();
  const orphanIds = new Set<string>();

  //  ① 같은 교시 줄에 그 반 칸 수가 기록과 같으면 **왼쪽부터 같은 순서**(열을 끼워도 순서는 안 바뀐다)
  //  ② 아니면 학생이 가장 많이 겹치는 칸. 동률이어도 반 구성이 같으면 어느 쪽이든 같은 답이다.
  const partnersOf = (cell: MetaCell, maxIdx: number): (ClassHit | null)[] | null => {
    const same = resolved.filter((c) => c.hits[0]?.ref.classId === cell.primaryClassId);
    const rowNow = byCol(same.filter((c) => c.cell.row === cell.row).map((c) => ({ ...c, col: c.cell.col })));
    const rowThen = byCol(meta.cells.filter((m) => m.primaryClassId === cell.primaryClassId && m.row === cell.row));
    if (rowNow.length > 0 && rowNow.length === rowThen.length) {
      const hit = rowNow[rowThen.indexOf(cell)]!;
      return hit.hits.length >= maxIdx ? hit.hits : null;
    }
    const scored = same
      .filter((c) => c.hits.length >= maxIdx)
      .map((c) => ({ c, score: cell.students.filter((s) => c.texts.has(s.text)).length }))
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) return null;
    const best = scored.filter((s) => s.score === scored[0]!.score);
    const shape = (c: ResolvedCell) => c.hits.map((h) => h?.key ?? "?").join("|");
    return best.every((s) => shape(s.c) === shape(best[0]!.c)) ? best[0]!.c.hits : null;
  };

  for (const cell of meta.cells) {
    const maxIdx = Math.max(0, ...cell.students.map((s) => s.classIdx));
    const partners = maxIdx >= 2 ? partnersOf(cell, maxIdx) : null;
    for (const s of cell.students) {
      if (s.section === "withdrawn") continue;
      // 칸 자체를 못 찾았으면 첫 반 학생도 지금 어느 칸에 있는지 모른다 — 다른 반의 '추가'로 읽지 않는다.
      if (maxIdx >= 2 && !partners) orphanIds.add(s.studentId);
      let classId: string | null = cell.primaryClassId;
      if (s.classIdx >= 2) {
        const hit = partners?.[s.classIdx - 1] ?? null;
        classId = hit?.ref.classId ?? null;
        if (!partners) {
          skipKeys.add(cell.primaryClassId);
          warn(`"${refs.nameOfClass(cell.primaryClassId)}" 합반 칸을 지금 격자에서 찾지 못해 그 칸 학생 변화는 읽지 않았습니다.`);
        } else if (hit && !hit.ref.classId) {
          // 내보낼 때 있던 반인데 수업목록에 그 이름이 없다 = 보낸 뒤 앱에서 이름이 바뀌었거나 종강했다(새 반이 아니다).
          skipKeys.add(hit.key);
          warn(`합반 칸의 "${hit.ref.name}" 반을 수업목록에서 찾지 못했습니다(이름이 바뀌었거나 종강) — 이 반은 읽지 않았습니다.`);
        }
      }
      if (!classId) {
        orphanIds.add(s.studentId);
        continue;
      }
      const roster = rosters.get(classId) ?? new Map<string, { text: string; count: number; held: boolean }>();
      const prev = roster.get(s.studentId);
      roster.set(s.studentId, {
        text: s.text,
        count: (prev?.count ?? 0) + 1,
        held: (prev?.held ?? true) && s.section === "hold",
      });
      rosters.set(classId, roster);
    }
  }
  return { rosters, skipKeys, orphanIds };
}
