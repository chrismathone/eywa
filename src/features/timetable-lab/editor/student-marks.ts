import type { Draft } from './model';
export function markStudentMoves(next: Draft, from: { id: string; name: string }, toId: string, students: string[], removeSource = true) {
  if (from.id === toId) return;
  next.studentMoves ??= {};
  for (const student of students) {
    const mark = next.studentMoves[from.id]?.[student] ?? { fromClassId: from.id, fromName: from.name };
    if (removeSource && next.studentMoves[from.id]) delete next.studentMoves[from.id][student];
    const to = next.studentMoves[toId] ??= {};
    if (mark.fromClassId === toId) delete to[student]; else to[student] = mark;
  }
}
export function moveNote(draft: Draft, classId: string, student: string) {
  const mark = draft.studentMoves?.[classId]?.[student];
  return mark ? `반 이동 · ${draft.classes?.[mark.fromClassId]?.name ?? mark.fromName}에서 옮김` : undefined;
}
