// "지금 격자의 명단" — 읽은 반 칸들을 반 단위로 모은다. 순수(delta.ts의 재료).

import { norm } from "../match";
import type { BeforeState, ResolvedCell } from "./delta-before";
import type { GridRefs } from "./delta-refs";
import { columnLetter } from "./grid-text";
import type { DeltaClassRef, DeltaSlot, DeltaStudent, GridClassCell, GridSection, ParsedMeta } from "./types";

export interface AfterMember {
  student: DeltaStudent;
  /** 그 반 칸들에 몇 번 적혔는지. */
  count: number;
  days: Set<string>;
  sections: Set<GridSection>;
}

export interface AfterClass {
  ref: DeltaClassRef;
  slots: DeltaSlot[];
  members: Map<string, AfterMember>;
}

export interface AfterState {
  classes: Map<string, AfterClass>;
  /** 합반 칸의 둘째 반 이상으로 선 반(비교 키). */
  secondary: Set<string>;
  /** 격자 어딘가에 적혀 있기는 한데 어느 반인지 못 읽은 학생 — 원래 반에서 '빠짐'으로 읽지 않는다. */
  heldIds: Set<string>;
  /** 반의 학생으로 읽은 자리("행:열") → 그 학생 id(시트가 모르는 글자면 null). */
  readAt: Map<string, string | null>;
  /** 퇴원 구역으로 읽은 자리("행:열") → 그 칸의 반들(비교 키). */
  withdrawnAt: Map<string, Set<string>>;
  studentCount: number;
}

const cellLabel = (cell: GridClassCell) => `${columnLetter(cell.col)}${cell.row + 1}`;

export function buildAfter(
  resolved: ResolvedCell[],
  before: BeforeState,
  refs: GridRefs,
  meta: ParsedMeta,
  out: { warn: (text: string) => void; notes: string[] },
): AfterState {
  const { rosters, skipKeys } = before;
  const classes = new Map<string, AfterClass>();
  const secondary = new Set<string>();
  const heldIds = new Set<string>();
  const readAt: AfterState["readAt"] = new Map();
  const withdrawnAt: AfterState["withdrawnAt"] = new Map();
  let studentCount = 0;

  /** 내보낸 격자에 없던 반인가(새 이름이거나, 수업목록엔 있는데 배치가 없던 반). */
  const unseen = (classId: string | null) => !classId || (!meta.classNameById.has(classId) && !rosters.has(classId));
  /** 글자 → 학생. 같은 글자의 학생이 둘이면 그 반에 원래 있던 쪽으로 읽는다. */
  const studentIn = (text: string, classId: string | null): DeltaStudent =>
    refs.studentOf(text, (id) => !!classId && !!rosters.get(classId)?.has(id));
  const hold = (text: string) => {
    const id = refs.studentOf(text).studentId;
    if (id) heldIds.add(id);
  };

  for (const { cell, hits } of resolved) {
    const merged = cell.classes.length > 1;
    const rooms = cell.room.split(" / ").map((r) => r.trim());
    const entries = hits.map((hit, i) => {
      if (!hit) return null;
      if (i > 0) secondary.add(hit.key);
      const entry: AfterClass = classes.get(hit.key) ?? { ref: hit.ref, slots: [], members: new Map() };
      // 이름을 병합 없이 윗줄에만 적은 칸: 내보낸 칸이면 "앞 시간만"이지만, 손으로 새로 적은 칸도 같은 모양이 된다
      // → 내보낸 격자에 없던 반이면 교시 전체로 읽고 그렇게 읽었다고 알린다.
      // 🔴 칸의 첫 반이 내보낸 격자에 있던 반이면 그 칸은 익스포터가 그린 것이다 — 학생 없는 합반 둘째 반은 기록에
      //    id가 없어 '없던 반'처럼 보이지만 넓히면 안 된다(손대지 않은 시트에 거짓 알림이 뜬다).
      const cls = cell.classes[i]!;
      const widen = !!cls.loneTop && unseen(hit.ref.classId) && unseen(hits[0]?.ref.classId ?? null);
      if (widen) out.notes.push(`"${cls.name}" — 반 이름이 한 줄에만 적혀 있어 교시 전체로 읽었습니다.`);
      entry.slots.push({
        teacher: cell.teacher,
        days: cell.days,
        periodIds: widen ? [cls.periodIds[0]!, cls.periodIds[0]!.replace(/-1$/, "-2")] : cls.periodIds,
        weekend: cell.weekend,
        room: merged && rooms.length === cell.classes.length ? rooms[i]! : merged ? "" : cell.room,
      });
      classes.set(hit.key, entry);
      return entry;
    });

    for (const st of cell.students) {
      if (st.section === "withdrawn") {
        withdrawnAt.set(`${st.row}:${st.col}`, new Set(hits.flatMap((hit) => (hit ? [hit.key] : []))));
        continue;
      }
      let entry = entries[0] ?? null;
      if (merged) {
        const tagged = st.classIdx >= 1 && st.classIdx <= entries.length;
        entry = tagged ? (entries[st.classIdx - 1] ?? null) : null;
        if (!tagged) {
          // 한 반짜리 칸에 반을 덧적으면 원래 학생 줄엔 [1]·[2]가 없다 → 그 학생이 원래 있던 반으로 읽는다.
          const home = entries.filter((e): e is AfterClass => {
            const id = e ? studentIn(st.text, e.ref.classId).studentId : null;
            return !!e && !!id && !!e.ref.classId && !!rosters.get(e.ref.classId)?.has(id);
          });
          if (home.length === 1) entry = home[0]!;
          else {
            // 어느 반인지 모른다 — 이 칸의 반들은 명단을 믿을 수 없으니 빠짐·추가를 내지 않는다.
            for (const hit of hits) if (hit) skipKeys.add(hit.key);
            out.warn(`${cellLabel(cell)} 합반 칸의 "${st.text}"에 [1]·[2] 표시가 없어 어느 반 학생인지 알 수 없습니다 — 이 칸의 반은 읽지 않았습니다.`);
            hold(st.text);
            continue;
          }
        }
      }
      if (!entry) {
        hold(st.text); // 반 이름이 모호해 못 읽은 칸
        continue;
      }
      studentCount += 1;
      const student = studentIn(st.text, entry.ref.classId);
      readAt.set(`${st.row}:${st.col}`, student.studentId);
      const key = student.studentId ? `id:${student.studentId}` : `text:${norm(st.text)}`;
      const member = entry.members.get(key) ?? { student, count: 0, days: new Set<string>(), sections: new Set<GridSection>() };
      member.count += 1;
      for (const day of st.days) member.days.add(day);
      member.sections.add(st.section);
      entry.members.set(key, member);
    }
  }

  // 읽지 않기로 한 반이 든 칸에 **새로 적힌** 학생은 다른 반에서 옮겨 온 것일 수 있다([2]를 달았어도 그 칸은 안 읽는다)
  // → 원래 반에서 '빠짐'으로 세지 않는다. 그 칸에 원래 있던 학생은 보류하지 않는다(다른 반에서 진짜 뺀 것을 가리지 않게).
  for (const { cell, hits } of resolved) {
    if (!hits.some((hit) => hit && skipKeys.has(hit.key))) continue;
    const wasHere = (id: string) => hits.some((hit) => hit?.ref.classId && rosters.get(hit.ref.classId)?.has(id));
    for (const st of cell.students) {
      const id = st.section === "withdrawn" ? null : refs.studentOf(st.text).studentId;
      if (id && !wasHere(id)) heldIds.add(id);
    }
  }

  return { classes, secondary, heldIds, readAt, withdrawnAt, studentCount };
}
