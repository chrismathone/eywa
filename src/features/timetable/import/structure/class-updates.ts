// 구조 import 적용 시 classes 담임/기본강의실 동기화 계획(순수함수 + Vitest).
// ⚠️ **변경된 반만** 갱신한다 — 스케줄이 안 바뀐 반은 담임 드리프트가 있어도 건드리지 않는다
// (사용자 요구: "변경되지 않은 부분은 건드리지 말고 변경되는 부분만"). changedClassIds = create/update/remove 대상 반.
// 담임 최빈값은 전 슬롯 **강사 이름 기준**(apply-english-schedules.cjs 규칙: 미해석 다수가 해석 소수에게
// 담임을 뺏기지 않도록 이름으로 세고, 해석될 때만 반영). 강의실은 classroomId 최빈.

import type { ApplyClassUpdate, MatchResult, ExistingContext } from "./types";

/** 최빈값 — 동률(top2 동수)이면 null(모호 → 기존 유지). */
function modal(m: Map<string, number>): string | null {
  if (!m.size) return null;
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0]![1] === sorted[1]![1]) return null;
  return sorted[0]![0];
}

/**
 * changedClassIds에 든 반만 대상으로, 전 슬롯 modal(강사이름·강의실)이 현재 classes 값과 다르면 갱신 계획을 만든다.
 * teacherId/classroomId=null이면 그 필드 미변경(RPC coalesce가 기존 유지). 해석·변경된 필드만 담는다.
 */
export function buildClassUpdates(
  match: MatchResult,
  ctx: ExistingContext,
  changedClassIds: Set<string>,
): ApplyClassUpdate[] {
  const prevById = new Map(ctx.classes.map((c) => [c.id, c]));
  const nameToTeacherId = new Map<string, string | null>();
  for (const s of match.resolved) if (!nameToTeacherId.has(s.teacherName)) nameToTeacherId.set(s.teacherName, s.teacherId);

  // modal은 반의 **전 슬롯**으로 계산(정확한 최빈값), 단 대상은 changedClassIds로 한정.
  const per = new Map<string, { names: Map<string, number>; rooms: Map<string, number> }>();
  for (const s of match.resolved) {
    if (!s.classId || !changedClassIds.has(s.classId)) continue;
    const e = per.get(s.classId) ?? per.set(s.classId, { names: new Map(), rooms: new Map() }).get(s.classId)!;
    e.names.set(s.teacherName, (e.names.get(s.teacherName) ?? 0) + 1);
    if (s.classroomId) e.rooms.set(s.classroomId, (e.rooms.get(s.classroomId) ?? 0) + 1);
  }

  const updates: ApplyClassUpdate[] = [];
  for (const [classId, e] of per) {
    const prev = prevById.get(classId);
    if (!prev) continue;
    const modalName = modal(e.names);
    const modalTeacherId = modalName ? nameToTeacherId.get(modalName) ?? null : null; // 미해석 최빈 → null(유지)
    const modalRoomId = modal(e.rooms);
    const setTeacher = modalTeacherId && modalTeacherId !== prev.teacherId ? modalTeacherId : null;
    const setRoom = modalRoomId && modalRoomId !== prev.classroomId ? modalRoomId : null;
    if (setTeacher || setRoom)
      updates.push({ classId, teacherId: setTeacher, classroomId: setRoom, prevTeacherId: prev.teacherId, prevClassroomId: prev.classroomId });
  }
  return updates;
}
