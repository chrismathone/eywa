import { days, lessons, patchCells, timeLabel, type Draft, type Lesson } from './model';
export type Position = { day: string; teacher: string; start: number };
export function moveBlocks(draft: Draft, ids: string[], anchorId: string, to: Position): Draft {
  const source = lessons(draft).items, anchor = source.find(p => p.id === anchorId);
  if (!anchor || !ids.includes(anchorId) || !days.includes(to.day) || !Number.isInteger(to.start) || !source.some(p => p.teacher === to.teacher)) throw new Error('옮길 수업과 위치를 선택하세요.');
  const selected = source.filter(p => ids.includes(p.id));
  if (selected.length !== new Set(ids).size) throw new Error('미확정 수업을 먼저 확인해 주세요.');
  const delta = to.start - anchor.start, dayDelta = days.indexOf(to.day) - days.indexOf(anchor.day);
  if (selected.some(p => p.start + delta < 0 || p.end + delta >= 1440 || !days[days.indexOf(p.day) + dayDelta])) throw new Error('선택한 수업이 하루 또는 일주일 범위를 벗어납니다. 원래 위치를 유지합니다.');
  const targetTeacher = source.find(p => p.teacher === to.teacher)?.teacherId ?? null;
  const targetSeat = source.some(p => p.teacher === to.teacher && p.kind === 'seat');
  if (selected.some(p => p.kind === 'block' && p.teacher === anchor.teacher && targetSeat)) throw new Error('비수업 일정은 강사 열에 놓아 주세요.');
  const value = (row: number, col: number, text: string) => ({ ...draft.cells[row][col], text, formula: undefined, richText: undefined });
  const next = patchCells(draft, selected.flatMap(p => [
    { row: p.row, col: 1, cell: value(p.row, 1, days[days.indexOf(p.day) + dayDelta]) },
    { row: p.row, col: 2, cell: value(p.row, 2, timeLabel(p.start + delta)) },
    { row: p.row, col: 3, cell: value(p.row, 3, timeLabel(p.end + delta)) },
    { row: p.row, col: 4, cell: value(p.row, 4, p.teacher === anchor.teacher ? to.teacher : p.teacher) },
  ]));
  next.placements = next.placements.map(p => ids.includes(p.id) && (draft.cells[p.row][4].text || '담당 미정') === anchor.teacher
    ? { ...p, teacherId: targetTeacher, kind: p.kind === 'block' ? 'block' : targetSeat ? 'seat' : 'lesson',
      labSeparate: targetSeat && to.teacher === 'LAB' && p.labSeparate ? true : undefined } : p);
  return next;
}
export function copyBlocks(draft: Draft, entries: Lesson[], anchorId: string, to: Position): Draft {
  const next = structuredClone(draft), ids: string[] = []; let copiedAnchor = '';
  for (const entry of entries) {
    const row = next.cells.length, id = crypto.randomUUID(); ids.push(id);
    if (entry.id === anchorId) copiedAnchor = id;
    next.cells.push([entry.name, entry.day, timeLabel(entry.start), timeLabel(entry.end), entry.teacher, entry.room].map(text => ({ text })));
    next.placements.push({ id, row, classId: entry.classId, teacherId: entry.teacherId, roomId: entry.roomId,
      kind: entry.kind, labSeparate: entry.labSeparate, sourceScheduleId: null, studentIds: [...entry.students] });
  }
  return moveBlocks(next, ids, copiedAnchor, to);
}
export function removeBlocks(draft: Draft, ids: string[]): Draft {
  const next = structuredClone(draft); next.placements = next.placements.filter(p => !ids.includes(p.id));
  return next; // Original roster/cell/source metadata is retained; no enrollment is ended.
}
