import { labelsOf, type Draft } from './model';
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

/** OUT은 표시 기록일 뿐, 배정·인원·충돌 계산에는 포함하지 않는다. 복사로 원래 반에 남은 학생은 OUT이 아니다. */
export function outgoingStudents(draft: Draft, classId: string) {
  const names = labelsOf(draft), present = new Set(draft.students[classId] ?? []), moved = new Map<string, string>();
  for (const [destination, students] of Object.entries(draft.studentMoves ?? {})) {
    for (const [id, mark] of Object.entries(students)) {
      if (mark.fromClassId === classId && !present.has(id) && draft.students[destination]?.includes(id)) moved.set(id, names[id] ?? '이름 미확인');
    }
  }
  return [...moved].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
