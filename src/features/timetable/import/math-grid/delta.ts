// 격자에서 읽은 명단 ↔ 시트가 알고 있던 명단(`_meta`) 비교 → 무엇이 바뀌었나. 순수.
//
// 기준선이 DB가 아니라 **시트 자신의 기록**인 이유: 시트에 다 못 그린 학생(재원 14줄 초과분)이나 시트를 보낸 뒤
// 앱에서 바뀐 것까지 "사람이 뺐다"로 읽으면 없는 퇴원이 생긴다. 사람이 손댄 것만 잡으려면 시트끼리 견준다.
// 🔴 확실하지 않으면 **빠짐을 내지 않는다** — 못 읽은 것은 경고로 알리고 그 반은 건드리지 않는다.

import { norm } from "../match";
import { buildBefore, type ResolvedCell } from "./delta-before";
import { buildGridRefs, type KnownClass } from "./delta-refs";
import { columnLetter, studentNameOf } from "./grid-text";
import type { DeltaClassRef, DeltaSlot, DeltaStudent, GridClassCell, GridDelta, ParsedMathGrid, ParsedMeta } from "./types";

export type { KnownClass };

interface AfterClass {
  ref: DeltaClassRef;
  slots: DeltaSlot[];
  /** 학생 키 → 그 반 칸들에 몇 번 적혔는지. */
  members: Map<string, { student: DeltaStudent; count: number }>;
}

const cellLabel = (cell: GridClassCell) => `${columnLetter(cell.col)}${cell.row + 1}`;

export function computeGridDelta(grid: ParsedMathGrid, meta: ParsedMeta, classes: KnownClass[]): GridDelta {
  const warnings = [...grid.warnings];
  const notes: string[] = [];
  const warn = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text);
  };
  const refs = buildGridRefs(meta, classes, warn);

  const resolved: ResolvedCell[] = grid.cells.map((cell) => ({
    cell,
    hits: cell.classes.map((cls) => refs.classOf(cls.name)),
    texts: new Set(cell.students.map((s) => s.text)),
  }));
  const { rosters: before, skipKeys, orphanIds } = buildBefore(meta, resolved, refs, warn);
  /** 내보낸 격자에 없던 반인가(새 이름이거나, 수업목록엔 있는데 배치가 없던 반). */
  const unseen = (classId: string | null) => !classId || (!meta.classNameById.has(classId) && !before.has(classId));
  /** 글자 → 학생. 같은 글자의 학생이 둘이면 그 반에 원래 있던 쪽으로 읽는다. */
  const studentIn = (text: string, classId: string | null): DeltaStudent =>
    refs.studentOf(text, (id) => !!classId && !!before.get(classId)?.has(id));

  // ── 지금 격자의 명단 ──
  const after = new Map<string, AfterClass>();
  const secondary = new Set<string>();
  /** 격자 어딘가에 적혀 있기는 한데 어느 반인지 못 읽은 학생 — 원래 반에서 '빠짐'으로 읽지 않는다. */
  const heldIds = new Set<string>();
  const hold = (text: string) => {
    const id = refs.studentOf(text).studentId;
    if (id) heldIds.add(id);
  };
  let studentCount = 0;
  for (const { cell, hits } of resolved) {
    const merged = cell.classes.length > 1;
    const rooms = cell.room.split(" / ").map((r) => r.trim());
    const entries = hits.map((hit, i) => {
      if (!hit) return null;
      if (i > 0) secondary.add(hit.key);
      const entry: AfterClass = after.get(hit.key) ?? { ref: hit.ref, slots: [], members: new Map() };
      // 이름을 병합 없이 윗줄에만 적은 칸: 내보낸 칸이면 "앞 시간만"이지만, 손으로 새로 적은 칸도 같은 모양이 된다
      // → 내보낸 격자에 없던 반이면 교시 전체로 읽고 그렇게 읽었다고 알린다.
      // 🔴 칸의 첫 반이 내보낸 격자에 있던 반이면 그 칸은 익스포터가 그린 것이다 — 학생 없는 합반 둘째 반은 기록에
      //    id가 없어 '없던 반'처럼 보이지만 넓히면 안 된다(손대지 않은 시트에 거짓 참고가 뜬다).
      const cls = cell.classes[i]!;
      const widen = !!cls.loneTop && unseen(hit.ref.classId) && unseen(hits[0]?.ref.classId ?? null);
      if (widen) notes.push(`"${cls.name}" — 반 이름이 한 줄에만 적혀 있어 교시 전체로 읽었습니다.`);
      entry.slots.push({
        teacher: cell.teacher,
        days: cell.days,
        periodIds: widen ? [cls.periodIds[0]!, cls.periodIds[0]!.replace(/-1$/, "-2")] : cls.periodIds,
        weekend: cell.weekend,
        room: merged && rooms.length === cell.classes.length ? rooms[i]! : merged ? "" : cell.room,
      });
      after.set(hit.key, entry);
      return entry;
    });
    for (const st of cell.students) {
      if (st.section === "withdrawn") continue;
      let entry = entries[0] ?? null;
      if (merged) {
        const tagged = st.classIdx >= 1 && st.classIdx <= entries.length;
        entry = tagged ? (entries[st.classIdx - 1] ?? null) : null;
        if (!tagged) {
          // 한 반짜리 칸에 반을 덧적으면 원래 학생 줄엔 [1]·[2]가 없다 → 그 학생이 원래 있던 반으로 읽는다.
          const home = entries.filter((e): e is AfterClass => {
            const id = e ? studentIn(st.text, e.ref.classId).studentId : null;
            return !!e && !!id && !!e.ref.classId && !!before.get(e.ref.classId)?.has(id);
          });
          if (home.length === 1) entry = home[0]!;
          else {
            // 어느 반인지 모른다 — 이 칸의 반들은 명단을 믿을 수 없으니 빠짐·추가를 내지 않는다.
            for (const hit of hits) if (hit) skipKeys.add(hit.key);
            warn(`${cellLabel(cell)} 합반 칸의 "${st.text}"에 [1]·[2] 표시가 없어 어느 반 학생인지 알 수 없습니다 — 이 칸의 반은 읽지 않았습니다.`);
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
      const key = student.studentId ? `id:${student.studentId}` : `text:${norm(st.text)}`;
      entry.members.set(key, { student, count: (entry.members.get(key)?.count ?? 0) + 1 });
    }
  }

  // 읽지 않기로 한 반이 든 칸에 **새로 적힌** 학생은 다른 반에서 옮겨 온 것일 수 있다([2]를 달았어도 그 칸은 안 읽는다)
  // → 원래 반에서 '빠짐'으로 세지 않는다. 그 칸에 원래 있던 학생은 보류하지 않는다(다른 반에서 진짜 뺀 것을 가리지 않게).
  for (const { cell, hits } of resolved) {
    if (!hits.some((hit) => hit && skipKeys.has(hit.key))) continue;
    const wasHere = (id: string) => hits.some((hit) => hit?.ref.classId && before.get(hit.ref.classId)?.has(id));
    for (const st of cell.students) {
      const id = st.section === "withdrawn" ? null : refs.studentOf(st.text).studentId;
      if (id && !wasHere(id)) heldIds.add(id);
    }
  }

  // ── 비교 ──
  const removals: { student: DeltaStudent; from: DeltaClassRef }[] = [];
  const additions: { student: DeltaStudent; to: DeltaClassRef }[] = [];
  for (const [classId, roster] of before) {
    if (skipKeys.has(classId)) continue;
    const now = after.get(classId);
    const from: DeltaClassRef = { classId, name: refs.nameOfClass(classId) };
    if (!now) {
      // 반 칸이 통째로 안 보인다 = 지웠거나 이름을 바꿨다. 전원 '빠짐'으로 읽으면 사고라 건드리지 않는다.
      warn(`"${from.name}" 반이 격자에서 보이지 않습니다(칸을 지웠거나 이름을 바꿈) — 이 반 학생이 빠진 것으로 읽지 않았습니다.`);
      continue;
    }
    for (const [studentId, info] of roster) {
      const here = now.members.get(`id:${studentId}`);
      if (here) {
        if (here.count < info.count) {
          notes.push(`${info.text} — "${from.name}"의 일부 칸에서만 빠졌습니다(요일·교시 일부만 바꾼 것은 아직 읽지 않습니다).`);
        }
        continue;
      }
      // 같은 반에 같은 이름의 '모르는 글자'가 새로 있으면 학교·학년만 고쳐 적은 것이다 — 빠짐·추가로 세지 않는다.
      const name = norm(studentNameOf(info.text));
      const retyped = [...now.members].find(([, m]) => !m.student.studentId && norm(studentNameOf(m.student.text)) === name);
      if (retyped) {
        now.members.delete(retyped[0]);
        notes.push(`${info.text} — "${from.name}"에서 글자만 바뀐 것으로 보고 변경으로 세지 않았습니다(${retyped[1].student.text}).`);
        continue;
      }
      // 못 읽은 칸에 적혀 있는 학생이면 옮긴 것일 수 있다 — 빠짐으로 읽지 않는다(그 칸은 경고로 알렸다).
      if (heldIds.has(studentId)) continue;
      removals.push({ student: { studentId, text: info.text }, from });
    }
  }
  for (const [key, entry] of after) {
    if (skipKeys.has(key)) continue;
    const roster = entry.ref.classId ? before.get(entry.ref.classId) : undefined;
    for (const { student } of entry.members.values()) {
      if (student.studentId && (roster?.has(student.studentId) || orphanIds.has(student.studentId))) continue;
      additions.push({ student, to: entry.ref });
    }
  }

  // 한 학생이 한 반에서 빠지고 한 반에 들어갔으면 '이동'으로 묶는다(여럿이 얽히면 묶지 않고 그대로 보인다).
  const tally = (ids: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const outCount = tally(removals.map((r) => r.student.studentId));
  const inCount = tally(additions.map((a) => a.student.studentId));
  const paired = (id: string | null) => !!id && outCount.get(id) === 1 && inCount.get(id) === 1;

  const newClasses: GridDelta["newClasses"] = [];
  const placedClasses: GridDelta["placedClasses"] = [];
  for (const [key, entry] of after) {
    if (skipKeys.has(key)) continue;
    const { classId, name } = entry.ref;
    const members = [...entry.members.values()].map((m) => m.student);
    if (!classId) newClasses.push({ name, slots: entry.slots, students: members });
    else if (unseen(classId) && !secondary.has(key) && !members.some((s) => s.studentId && orphanIds.has(s.studentId))) {
      placedClasses.push({ classId, name, slots: entry.slots });
    }
  }

  return {
    newClasses,
    placedClasses,
    moves: removals
      .filter((r) => paired(r.student.studentId))
      .map((r) => ({
        student: r.student,
        from: r.from,
        to: additions.find((a) => a.student.studentId === r.student.studentId)!.to,
      })),
    adds: additions.filter((a) => !paired(a.student.studentId)),
    removes: removals.filter((r) => !paired(r.student.studentId)),
    notes,
    warnings,
    stats: { classCells: grid.cells.length, students: studentCount },
  };
}
