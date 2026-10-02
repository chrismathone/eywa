import { labelsOf, lessons, type Draft, type Lesson } from './model';
import { markStudentMoves } from './student-marks';
import { keepColumns } from './teachers';

export function classList(draft: Draft) {
  const result = new Map<string, { id: string; name: string; items: Lesson[]; students: string[] }>();
  for (const p of lessons(draft).items) {
    if (p.kind === 'block' || !p.classId) continue;
    const entry = result.get(p.classId) ?? { id: p.classId, name: p.name, items: [], students: [] };
    entry.items.push(p); entry.students = [...new Set([...entry.students, ...p.students])]; result.set(p.classId, entry);
  }
  return [...result.values()];
}
function requireClass(draft: Draft, id: string) {
  const group = classList(draft).find(c => c.id === id);
  if (!group || group.items.length !== draft.placements.filter(p => p.classId === id && p.kind !== 'block').length) throw new Error('이 반의 수업 정보를 먼저 확인해 주세요.');
  return group;
}
export function checkClassName(draft: Draft, name: string, except?: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error('반 이름은 1~80자로 입력해 주세요.');
  if (classList(draft).some(c => c.id !== except && c.name === trimmed)) throw new Error('이미 있는 반 이름입니다. 구분할 수 있는 이름을 입력해 주세요.');
  return trimmed;
}
/** 반 이름·명단이 바뀌는 명령은 이 번호를 올려 예전 복사 내용을 무효로 만든다. */
export function changed(draft: Draft) {
  const next = structuredClone(draft); next.classRevision = (draft.classRevision ?? 0) + 1; return next;
}
/** 반 명단(students[id])을 그 반 수업들의 실제 배정에서 다시 만든다. */
export function roster(next: Draft, id: string) {
  next.students[id] = [...new Set(next.placements.filter(p => p.classId === id).flatMap(p => p.studentIds ?? next.students[id] ?? []))];
}
export function renameClass(draft: Draft, id: string, name: string): Draft {
  const group = requireClass(draft, id), value = checkClassName(draft, name, id);
  if (value === group.name) return draft;
  const next = changed(draft); (next.classes ??= {})[id] = { ...next.classes?.[id], name: value };
  for (const p of group.items) next.cells[p.row][0] = { ...next.cells[p.row][0], text: value, formula: undefined, richText: undefined };
  return next;
}
/** Integrated roster has no day axis: move the student to ALL destination lessons. */
export function moveClassStudent(draft: Draft, studentId: string, fromId: string, toId: string): Draft {
  const from = requireClass(draft, fromId), to = requireClass(draft, toId);
  if (fromId === toId || !from.students.includes(studentId) || !labelsOf(draft)[studentId]) throw new Error('옮길 학생과 다른 반을 선택해 주세요.');
  const next = changed(draft), byId = new Map([...from.items, ...to.items].map(p => [p.id, p]));
  for (const p of next.placements) {
    const item = byId.get(p.id); if (!item) continue;
    p.studentIds = p.classId === fromId ? item.students.filter(id => id !== studentId) : [...new Set([...item.students, studentId])];
  }
  roster(next, fromId); roster(next, toId); markStudentMoves(next, from, toId, [studentId]); return next;
}
/** The chosen destination keeps its schedule, color, name and class identity. */
export function mergeClasses(draft: Draft, fromId: string, toId: string): Draft {
  const from = requireClass(draft, fromId), to = requireClass(draft, toId);
  if (fromId === toId) throw new Error('합칠 다른 반을 선택해 주세요.');
  if (from.items.some(p => p.locked)) throw new Error('잠근 수업이 있습니다. 잠금을 풀고 다시 해 주세요.');
  const next = changed(draft), students = [...new Set([...to.students, ...from.students])];
  markStudentMoves(next, from, toId, from.students.filter(id => !to.students.includes(id)));
  next.placements = next.placements.filter(p => p.classId !== fromId);
  for (const p of next.placements) if (p.classId === toId) p.studentIds = [...students];
  delete next.students[fromId]; if (next.classes) delete next.classes[fromId]; next.students[toId] = students;
  for (const group of next.appearance?.groups?.groups ?? []) group.classIds = group.classIds.filter(id => id !== fromId);
  return keepColumns(draft, next);
}
/** Selected students retain their attendance days; the new class initially shares the timetable. */
export function splitClass(draft: Draft, id: string, name: string, chosen: string[]): Draft {
  const source = requireClass(draft, id), value = checkClassName(draft, name), ids = [...new Set(chosen)];
  if (!ids.length || ids.length >= source.students.length || ids.some(s => !source.students.includes(s))) throw new Error('새 반으로 옮길 학생을 선택하고, 원래 반에도 1명 이상 남겨 주세요.');
  const next = changed(draft), newId = crypto.randomUUID();
  (next.classes ??= {})[newId] = { ...next.classes?.[id], name: value };
  for (const item of source.items) {
    const p = next.placements.find(p => p.id === item.id)!;
    p.studentIds = item.students.filter(s => !ids.includes(s));
    const row = next.cells.length, cells = structuredClone(next.cells[p.row]);
    cells[0] = { ...cells[0], text: value, formula: undefined, richText: undefined }; next.cells.push(cells);
    next.placements.push({ ...p, id: crypto.randomUUID(), sourceScheduleId: null, classId: newId, row,
      studentIds: item.students.filter(s => ids.includes(s)) });
  }
  roster(next, id); roster(next, newId);
  markStudentMoves(next, source, newId, ids);
  for (const group of next.appearance?.groups?.groups ?? []) {
    const index = group.classIds.indexOf(id); if (index >= 0) group.classIds.splice(index + 1, 0, newId);
  }
  return next;
}
