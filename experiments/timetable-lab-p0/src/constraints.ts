import { lessons, patchCells, timeLabel, type Draft, type Lesson } from './model';

export type Issue = { key: string; message: string; placementIds: string[] };
const overlaps = (a: Lesson, b: Lesson) => a.day === b.day && a.start < b.end && b.start < a.end;
// Synthetic cross-subject occupancy. Production interval adapters are not implemented in P0.
const math: Lesson = { id: 'math-1', sourceScheduleId: 'math-source', classId: 'math-class', row: -1,
  name: '수학 샘플', day: '월', start: 1080, end: 1140, teacher: '수학 강사', room: '301', students: ['s1'] };
export function validate(draft: Draft) {
  const { items, incomplete } = lessons(draft);
  const all = [...items, math], issues: Issue[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (!overlaps(a, b)) continue;
    const axes: string[] = [];
    if (a.teacher === b.teacher) axes.push('강사');
    if (a.room === b.room) axes.push('강의실');
    if (a.students.some(id => b.students.includes(id))) axes.push('학생');
    if (axes.length) issues.push({ key: `${a.id}/${b.id}/${axes.join(',')}`, placementIds: [a.id, b.id],
      message: `${a.name} ↔ ${b.name}: ${a.day} ${timeLabel(Math.max(a.start, b.start))}~${timeLabel(Math.min(a.end, b.end))} ${axes.join('·')} 겹침` });
  }
  return { issues, incomplete };
}
export type Candidate = { revision: number; placementId: string; start: number; end: number; draft: Draft; label: string };
export function suggest(draft: Draft, placementId: string, revision: number): Candidate[] {
  const source = lessons(draft).items.find(p => p.id === placementId);
  if (!source || validate(draft).incomplete.length || draft.placements.some(p => draft.cells[p.row].some(c => c.formula))) return [];
  const baseline = new Set(validate(draft).issues.filter(x => !x.placementIds.includes(placementId)).map(x => x.key));
  const candidates: Candidate[] = [];
  for (let start = 960; start + source.end - source.start <= 1320; start += 10) {
    if (start === source.start) continue;
    const end = start + source.end - source.start;
    const next = patchCells(draft, [
      { row: source.row, col: 2, cell: { ...draft.cells[source.row][2], text: timeLabel(start), richText: undefined } },
      { row: source.row, col: 3, cell: { ...draft.cells[source.row][3], text: timeLabel(end), richText: undefined } },
    ]);
    if (validate(next).issues.some(x => !baseline.has(x.key))) continue;
    candidates.push({ revision, placementId, start, end, draft: next,
      label: `${source.day} ${timeLabel(start)}~${timeLabel(end)} · 같은 강사·강의실` });
  }
  return candidates.sort((a, b) => Math.abs(a.start - source.start) - Math.abs(b.start - source.start) || a.start - b.start).slice(0, 3);
}
