import { labelsOf, lessons, type Draft } from './model';
import { markStudentMoves } from './student-marks';

/** This placement only. No other day, class enrollment, or outside-subject roster is removed. */
export function moveStudent(draft: Draft, studentId: string, fromId: string, toId: string): Draft {
  const items = lessons(draft).items, from = items.find(p => p.id === fromId), to = items.find(p => p.id === toId);
  if (!labelsOf(draft)[studentId] || !from?.students.includes(studentId) || !to || to.kind === 'block' || fromId === toId) throw new Error('옮길 학생과 반·수업 시간을 확인해 주세요.');
  const next = structuredClone(draft);
  next.classRevision = (draft.classRevision ?? 0) + 1;
  next.placements = next.placements.map(p => p.id === fromId ? { ...p, studentIds: from.students.filter(id => id !== studentId) }
    : p.id === toId ? { ...p, studentIds: [...new Set([...to.students, studentId])] } : p);
  if (!to.students.includes(studentId)) markStudentMoves(next, { id: from.classId, name: from.name }, to.classId, [studentId], false);
  return next;
}
