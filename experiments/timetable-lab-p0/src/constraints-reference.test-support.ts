import { lessons, patchCells, timeLabel, type Draft, type Lesson } from './model';
import { isOperatingTime, operatingHoursOf } from './operating-times';

export type Issue = { key: string; message: string; placementIds: string[] };
const overlaps = (a: Lesson, b: Lesson) => a.day === b.day && a.start < b.end && b.start < a.end;
// Used by the explicit example only. Imported drafts carry their own outside-subject snapshot.
const math: Lesson = { id: 'math-1', sourceScheduleId: 'math-source', classId: 'math-class', row: -1,
  name: '수학 샘플', day: '월', start: 1080, end: 1140, teacher: '수학 강사', room: '301', students: ['s1'] };
export function referenceValidate(draft: Draft) {
  const { items, incomplete } = lessons(draft);
  const all = [...items, ...(draft.outside ?? [math])], issues: Issue[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (!overlaps(a, b)) continue;
    const axes: string[] = [];
    const seats = a.kind === 'seat' || b.kind === 'seat';
    if (!seats && (a.teacherId && b.teacherId ? a.teacherId === b.teacherId : a.teacher === b.teacher)) axes.push('강사');
    if (!seats && a.room && b.room && (a.roomId && b.roomId ? a.roomId === b.roomId : a.room === b.room)) axes.push('강의실');
    if (a.students.some(id => b.students.includes(id))) axes.push('학생');
    if (axes.length) issues.push({ key: `${a.id}/${b.id}/${axes.join(',')}`, placementIds: [a.id, b.id],
      message: `${a.name} ↔ ${b.name}: ${a.day} ${timeLabel(Math.max(a.start, b.start))}~${timeLabel(Math.min(a.end, b.end))} ${axes.join('·')} 겹침` });
  }
  return { issues, incomplete: [...incomplete, ...draft.source?.uncertainties ?? []] };
}
export type Candidate = { revision: number; placementId: string; start: number; end: number; draft: Draft; label: string };
export function referenceSuggest(draft: Draft, placementId: string, revision: number): Candidate[] {
  const source = lessons(draft).items.find(p => p.id === placementId);
  if (!source || referenceValidate(draft).incomplete.length || draft.placements.some(p => draft.cells[p.row].some(c => c.formula))) return [];
  const baseline = new Set(referenceValidate(draft).issues.filter(x => !x.placementIds.includes(placementId)).map(x => x.key));
  const candidates: Candidate[] = [];
  const hours = operatingHoursOf(draft)[source.day] ?? [];
  for (let start = Math.min(...hours.map(r => r.start)); start + source.end - source.start <= Math.max(...hours.map(r => r.end)); start += draft.source?.step ?? 10) {
    if (start === source.start) continue;
    const end = start + source.end - source.start;
    if (!isOperatingTime(draft, source.day, start, end)) continue;
    const next = patchCells(draft, [
      { row: source.row, col: 2, cell: { ...draft.cells[source.row][2], text: timeLabel(start), richText: undefined } },
      { row: source.row, col: 3, cell: { ...draft.cells[source.row][3], text: timeLabel(end), richText: undefined } },
    ]);
    if (referenceValidate(next).issues.some(x => !baseline.has(x.key))) continue;
    candidates.push({ revision, placementId, start, end, draft: next,
      label: `${source.day} ${timeLabel(start)}~${timeLabel(end)} · 같은 강사·강의실` });
  }
  return candidates.sort((a, b) => Math.abs(a.start - source.start) - Math.abs(b.start - source.start) || a.start - b.start).slice(0, 3);
}
