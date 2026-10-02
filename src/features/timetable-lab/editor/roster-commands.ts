import { changed, classList, roster } from './class-commands';
import { labelsOf, type Draft } from './model';

const clean = (name: string) => {
  const value = name.trim();
  if (!value || value.length > 40) throw new Error('학생 이름은 1~40자로 입력해 주세요.');
  return value;
};
function requireClass(draft: Draft, classId: string) {
  const group = classList(draft).find(c => c.id === classId);
  if (!group) throw new Error('반을 다시 선택해 주세요.');
  return group;
}
function requireStudent(draft: Draft, studentId: string) {
  if (!labelsOf(draft)[studentId]) throw new Error('학생을 다시 선택해 주세요.');
}
/** 연습본의 학생 이름표. 예제 연습본은 이름표가 따로 없어 처음 바꿀 때 만들어 둔다. */
function people(next: Draft) {
  return next.people ??= { ...labelsOf(next) };
}

/**
 * 연습본에만 있는 새 학생(입학 예정 등)을 만든다. 운영 원생목록에는 생기지 않는다.
 * 같은 이름을 막지 않는다 — 동명이인이 실제로 있다.
 */
export function createStudent(draft: Draft, name: string): { draft: Draft; id: string } {
  const value = clean(name), next = changed(draft), id = `new:${crypto.randomUUID()}`;
  people(next)[id] = value;
  return { draft: next, id };
}
export function renameStudent(draft: Draft, studentId: string, name: string): Draft {
  requireStudent(draft, studentId);
  const value = clean(name);
  if (labelsOf(draft)[studentId] === value) return draft;
  const next = changed(draft);
  people(next)[studentId] = value;
  return next;
}
/**
 * 학생을 반에 넣는다. 다른 반 배정은 건드리지 않는다(두 반을 함께 다닐 수 있다).
 * `lessonIds`를 주면 그 수업에만, 안 주면 그 반의 모든 수업에 넣는다.
 */
export function addStudentToClass(draft: Draft, studentId: string, classId: string, lessonIds?: string[]): Draft {
  requireStudent(draft, studentId);
  const group = requireClass(draft, classId), wanted = new Set(lessonIds ?? group.items.map(p => p.id));
  const targets = group.items.filter(p => wanted.has(p.id) && !p.students.includes(studentId));
  if (lessonIds && lessonIds.some(id => !group.items.some(p => p.id === id))) throw new Error('이 반의 수업만 고를 수 있습니다.');
  if (!targets.length) throw new Error('이미 이 반에 있는 학생입니다.');
  const next = changed(draft), adding = new Set(targets.map(p => p.id)), byId = new Map(group.items.map(p => [p.id, p]));
  for (const p of next.placements) {
    const item = byId.get(p.id);
    // 이 반의 모든 수업에 명단을 따로 적어 둔다 — 안 적힌 수업은 반 명단을 그대로 따라가 고르지 않은 수업에도 학생이 들어간다.
    if (item) p.studentIds = adding.has(p.id) ? [...item.students, studentId] : [...item.students];
  }
  roster(next, classId);
  return next;
}
/** 학생을 이 반의 모든 수업에서 뺀다. 다른 반 배정은 그대로다. */
export function removeStudentFromClass(draft: Draft, studentId: string, classId: string): Draft {
  const group = requireClass(draft, classId);
  if (!group.students.includes(studentId)) throw new Error('이 반에 없는 학생입니다.');
  const next = changed(draft), byId = new Map(group.items.map(p => [p.id, p]));
  for (const p of next.placements) {
    const item = byId.get(p.id);
    if (item) p.studentIds = item.students.filter(id => id !== studentId);
  }
  roster(next, classId);
  if (next.studentMoves?.[classId]) delete next.studentMoves[classId][studentId];
  return next;
}
/**
 * 학생이 이 반에서 **어느 수업에 오는지** 정한다(월·수만 오는 학생 등).
 * 한 수업도 고르지 않으면 반에서 빠진다.
 */
export function setStudentLessons(draft: Draft, studentId: string, classId: string, lessonIds: string[]): Draft {
  requireStudent(draft, studentId);
  const group = requireClass(draft, classId), wanted = new Set(lessonIds);
  if (lessonIds.some(id => !group.items.some(p => p.id === id))) throw new Error('이 반의 수업만 고를 수 있습니다.');
  if (group.items.every(p => p.students.includes(studentId) === wanted.has(p.id))) return draft;
  const next = changed(draft), byId = new Map(group.items.map(p => [p.id, p]));
  for (const p of next.placements) {
    const item = byId.get(p.id);
    if (!item) continue;
    // 이미 오던 수업은 명단 순서를 건드리지 않는다.
    if (wanted.has(p.id)) p.studentIds = item.students.includes(studentId) ? [...item.students] : [...item.students, studentId];
    else p.studentIds = item.students.filter(id => id !== studentId);
  }
  roster(next, classId);
  if (!wanted.size && next.studentMoves?.[classId]) delete next.studentMoves[classId][studentId];
  return next;
}
/** 이 학생이 다니는 반과 수업(동선 보기·관리 화면이 쓴다). */
export function studentSchedule(draft: Draft, studentId: string) {
  return classList(draft).flatMap(c => {
    const items = c.items.filter(p => p.students.includes(studentId));
    return items.length ? [{ classId: c.id, name: c.name, items }] : [];
  });
}
