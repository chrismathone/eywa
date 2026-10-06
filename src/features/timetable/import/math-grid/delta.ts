// 격자에서 읽은 명단 ↔ 시트가 알고 있던 명단(`_meta`) 비교 → 무엇이 바뀌었나. 순수.
//
// 기준선이 DB가 아니라 **시트 자신의 기록**인 이유: 시트에 다 못 그린 학생(재원 14줄 초과분)이나 시트를 보낸 뒤
// 앱에서 바뀐 것까지 "사람이 뺐다"로 읽으면 없는 퇴원이 생긴다. 사람이 손댄 것만 잡으려면 시트끼리 견준다.
// 🔴 확실하지 않으면 **빠짐을 내지 않는다** — 못 읽은 것은 경고로, 읽었지만 시트로 안 바꾸는 것은 이유와 함께 알린다.

import { norm } from "../match";
import { buildAfter, type AfterClass, type AfterMember } from "./delta-after";
import { buildBefore, type ResolvedCell } from "./delta-before";
import { roomSharingNotes, splitRenames, type RawAddition } from "./delta-post";
import { buildGridRefs, type KnownClass } from "./delta-refs";
import { buildStrayFinder, strayWhy } from "./delta-stray";
import { KO_DAYS, studentNameOf } from "./grid-text";
import type { DeltaClassRef, DeltaIgnored, DeltaStudent, GridDelta, ParsedMathGrid, ParsedMeta } from "./types";

export type { KnownClass };

const PARTIAL_WHY = "요일·교시 일부만 바꾼 것은 시트로 바꾸지 않습니다 — 학생 화면의 등원 요일에서 바꿔 주세요.";
const HOLD_WHY = "휴원(대기) 전환은 시트로 바꾸지 않습니다 — 학생 화면에서 바꿔 주세요.";
const UNREAD_ADD_WHY =
  "이 학생이 다른 칸에 새로 적혀 있지만 그 변경을 읽지 않아(반 이름 변경·사라진 반·찾지 못한 합반 칸), 원래 반 수강도 그대로 둡니다 — 그쪽을 먼저 정리한 뒤 다시 불러오세요.";

/** 그 반에서 학생이 적힌 요일 — 반의 모든 요일이면 빈 배열(전 요일 등원). */
function memberDays(entry: AfterClass, member: AfterMember): string[] {
  const all = KO_DAYS.filter((d) => entry.slots.some((s) => s.days.includes(d)));
  const mine = all.filter((d) => member.days.has(d));
  return mine.length === 0 || mine.length === all.length ? [] : mine;
}

export function computeGridDelta(grid: ParsedMathGrid, meta: ParsedMeta, classes: KnownClass[]): GridDelta {
  const warnings = [...grid.warnings];
  const notes: string[] = [];
  const ignored: DeltaIgnored[] = [];
  const warn = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text);
  };
  const refs = buildGridRefs(meta, classes, warn);

  const resolved: ResolvedCell[] = grid.cells.map((cell) => ({
    cell,
    hits: cell.classes.map((cls) => refs.classOf(cls.name)),
    texts: new Set(cell.students.map((s) => s.text)),
  }));
  const before = buildBefore(meta, resolved, refs, warn);
  const after = buildAfter(resolved, before, refs, meta, { warn, notes });
  const { rosters, skipKeys, orphanIds } = before;
  const strayAt = buildStrayFinder(grid, meta, after, (text) => refs.studentOf(text).studentId);
  const allHold = (member: AfterMember) => [...member.sections].every((s) => s === "hold");

  // ── 비교: 빠진 학생 ──
  const found: { student: DeltaStudent; from: DeltaClassRef; wasHeld: boolean }[] = [];
  /** 격자에서 통째로 사라진 반의 학생 → 그 반 이름. */
  const goneWith = new Map<string, string>();
  for (const [classId, roster] of rosters) {
    if (skipKeys.has(classId)) continue;
    const now = after.classes.get(classId);
    const from: DeltaClassRef = { classId, name: refs.nameOfClass(classId) };
    if (!now) {
      // 반 칸이 통째로 안 보인다 = 지웠거나 이름을 바꿨다. 전원 '빠짐'으로 읽으면 사고라 건드리지 않는다.
      warn(`"${from.name}" 반이 격자에서 보이지 않습니다(칸을 지웠거나 이름을 바꿈) — 이 반 학생이 빠진 것으로 읽지 않았습니다.`);
      for (const id of roster.keys()) goneWith.set(id, from.name);
      continue;
    }
    for (const [studentId, info] of roster) {
      const here = now.members.get(`id:${studentId}`);
      if (here) {
        if (here.count < info.count) ignored.push({ what: `${info.text} — "${from.name}"의 일부 칸에서만 빠짐`, why: PARTIAL_WHY });
        const held = allHold(here);
        if (held !== info.held) {
          ignored.push({ what: `${info.text} — "${from.name}" ${info.held ? "대기 → 재원" : "재원 → 대기"}`, why: HOLD_WHY });
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
      if (after.heldIds.has(studentId)) continue;
      // 읽지 못한 자리(머리가 빈 열·인원 줄·남의 반 퇴원 줄·고쳐 적은 글자)에 이름이 남아 있으면 종료로 쓰지 않는다.
      const stray = strayAt({ studentId, text: info.text }, classId);
      if (stray) {
        ignored.push({ what: `${info.text} — "${from.name}"에서 빠짐`, why: strayWhy(stray) });
        continue;
      }
      found.push({ student: { studentId, text: info.text }, from, wasHeld: info.held });
    }
  }

  // ── 비교: 새로 적힌 학생 ──
  const raw: RawAddition[] = [];
  /** 다른 칸에 새로 적혀 있지만 '추가'로 읽지 않은 학생(원래 반을 되찾지 못함·사라진 반·반 이름 변경). */
  const unreadAdds = new Set<string>();
  for (const [key, entry] of after.classes) {
    if (skipKeys.has(key)) continue;
    const roster = entry.ref.classId ? rosters.get(entry.ref.classId) : undefined;
    for (const member of entry.members.values()) {
      const id = member.student.studentId;
      if (id && roster?.has(id)) continue;
      if (id && orphanIds.has(id)) {
        unreadAdds.add(id);
        continue;
      }
      raw.push({ student: member.student, to: entry.ref, days: memberDays(entry, member), key, toHold: allHold(member) });
    }
  }
  // 사라진 반의 학생이 새 칸에 서 있으면 옮긴 것인지 반 이름을 바꾼 것인지 알 수 없다 → 추가로 읽지 않고 알린다.
  const { additions, renamedKeys, dropped } = splitRenames(raw, after.classes, goneWith, skipKeys, ignored);
  for (const id of dropped) unreadAdds.add(id);
  // 🔴 도착을 읽지 않은 학생의 '빠짐'은 종료로 쓰지 않는다 — 두 반을 다니는 학생을 옮기면서 다른 반 칸을 지우거나
  //    이름을 고치면 "새 반으로의 추가"는 버려지고 "원래 반 종료"만 남았다(재리뷰 재현).
  const removals = found.filter((r) => {
    if (!unreadAdds.has(r.student.studentId!)) return true;
    ignored.push({ what: `${r.student.text} — "${r.from.name}"에서 빠짐`, why: UNREAD_ADD_WHY });
    return false;
  });

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
  const classSlots: GridDelta["classSlots"] = [];
  /** 내보낼 때 그 반 칸에 적혀 있던 강의실(합반 칸의 "A / B"는 어느 반 것인지 못 갈라 뺀다). */
  const roomWas = (classId: string) => [
    ...new Set(meta.cells.filter((c) => c.primaryClassId === classId && c.room && !c.room.includes(" / ")).map((c) => c.room)),
  ];
  /** 내보낸 격자에 없던 반인가(수업목록엔 있는데 배치가 없던 반). */
  const unseen = (classId: string) => !meta.classNameById.has(classId) && !rosters.has(classId);
  for (const [key, entry] of after.classes) {
    if (skipKeys.has(key) || renamedKeys.has(key)) continue;
    const { classId, name } = entry.ref;
    const members = [...entry.members.values()].map((m) => m.student);
    if (!classId) newClasses.push({ name, slots: entry.slots, students: members });
    else if (unseen(classId) && !after.secondary.has(key) && !members.some((s) => s.studentId && orphanIds.has(s.studentId))) {
      placedClasses.push({ classId, name, slots: entry.slots });
    } else classSlots.push({ classId, name, slots: entry.slots, roomWas: roomWas(classId) });
  }
  notes.push(...roomSharingNotes(newClasses, resolved));

  return {
    newClasses,
    placedClasses,
    moves: removals
      .filter((r) => paired(r.student.studentId))
      .map((r) => {
        const add = additions.find((a) => a.student.studentId === r.student.studentId)!;
        // 대기 구역 표시는 해당할 때만 싣는다(대부분의 변경에는 없다).
        return { student: r.student, from: r.from, to: add.to, days: add.days, ...(add.toHold ? { toHold: true } : {}), ...(r.wasHeld ? { wasHeld: true } : {}) };
      }),
    adds: additions
      .filter((a) => !paired(a.student.studentId))
      .map(({ student, to, days, toHold }) => ({ student, to, days, ...(toHold ? { toHold: true } : {}) })),
    removes: removals.filter((r) => !paired(r.student.studentId)).map(({ student, from }) => ({ student, from })),
    classSlots,
    ignored,
    notes,
    warnings,
    stats: { classCells: grid.cells.length, students: after.studentCount },
  };
}
