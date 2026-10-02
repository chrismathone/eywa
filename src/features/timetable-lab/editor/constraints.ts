import { lessons, patchCells, timeLabel, type Draft, type Lesson } from './model';
import { isOperatingTime, operatingHoursOf } from './operating-times';

export type Issue = { key: string; message: string; placementIds: string[] };
const overlaps = (a: Lesson, b: Lesson) => a.day === b.day && a.start < b.end && b.start < a.end;
// Used by the explicit example only. Imported drafts carry their own outside-subject snapshot.
const math: Lesson = { id: 'math-1', sourceScheduleId: 'math-source', classId: 'math-class', row: -1,
  name: '수학 샘플', day: '월', start: 1080, end: 1140, teacher: '수학 강사', room: '301', students: ['s1'] };
/** 겹침 검사에 함께 넣는 다른 과목 수업. */
export const outsideOf = (draft: Draft) => draft.outside ?? [math];
type Lookup = Map<string, number[]>;
type Axis = { ids: Lookup; labels: Lookup; labelsWithoutId: Lookup };
type DayIndex = { teachers: Axis; rooms: Axis; students: Lookup };
type Pair = { a: number; b: number; axes: string[] };
const axis = (): Axis => ({ ids: new Map(), labels: new Map(), labelsWithoutId: new Map() });
const add = (map: Lookup, key: string, index: number) => {
  const values = map.get(key); if (values) values.push(index); else map.set(key, [index]);
};
function addAxis(index: Axis, id: string | null | undefined, label: string, position: number) {
  add(index.labels, label, position);
  if (id) add(index.ids, id, position); else add(index.labelsWithoutId, label, position);
}
function axisMatches(index: Axis, id: string | null | undefined, label: string): number[] {
  // IDs win only when BOTH sides have IDs. A label-only imported slot still matches a known teacher.
  return id ? [...index.ids.get(id) ?? [], ...index.labelsWithoutId.get(label) ?? []] : index.labels.get(label) ?? [];
}
function conflictIndex(all: Lesson[]) {
  const byDay = new Map<string, DayIndex>();
  const rosters = all.map(p => new Set(p.students));
  all.forEach((p, i) => {
    let day = byDay.get(p.day);
    if (!day) { day = { teachers: axis(), rooms: axis(), students: new Map() }; byDay.set(p.day, day); }
    if (p.kind !== 'seat') {
      addAxis(day.teachers, p.teacherId, p.teacher, i);
      if (p.room) addAxis(day.rooms, p.roomId, p.room, i);
    }
    for (const student of rosters[i]) add(day.students, student, i);
  });
  const related = (i: number) => {
    const p = all[i], day = byDay.get(p.day)!, result = new Set<number>();
    if (p.kind !== 'seat') {
      for (const other of axisMatches(day.teachers, p.teacherId, p.teacher)) result.add(other);
      if (p.room) for (const other of axisMatches(day.rooms, p.roomId, p.room)) result.add(other);
    }
    for (const student of rosters[i]) for (const other of day.students.get(student) ?? []) result.add(other);
    return result;
  };
  const pair = (i: number, j: number): Pair => {
    const a = all[i], b = all[j], axes: string[] = [], seats = a.kind === 'seat' || b.kind === 'seat';
    if (!seats && (a.teacherId && b.teacherId ? a.teacherId === b.teacherId : a.teacher === b.teacher)) axes.push('강사');
    if (!seats && a.room && b.room && (a.roomId && b.roomId ? a.roomId === b.roomId : a.room === b.room)) axes.push('강의실');
    const [small, large] = rosters[i].size < rosters[j].size ? [rosters[i], rosters[j]] : [rosters[j], rosters[i]];
    for (const id of small) if (large.has(id)) { axes.push('학생'); break; }
    return { a: i, b: j, axes };
  };
  return { related, pair };
}
const pairKey = (all: Lesson[], p: Pair) => `${all[p.a].id}/${all[p.b].id}/${p.axes.join(',')}`;
function issueOf(all: Lesson[], p: Pair): Issue {
  const a = all[p.a], b = all[p.b];
  return { key: pairKey(all, p), placementIds: [a.id, b.id],
    message: `${a.name} ↔ ${b.name}: ${a.day} ${timeLabel(Math.max(a.start, b.start))}~${timeLabel(Math.min(a.end, b.end))} ${p.axes.join('·')} 겹침` };
}
function currentPairs(all: Lesson[], ownCount: number, index: ReturnType<typeof conflictIndex>) {
  const result: Pair[] = [];
  for (let i = 0; i < ownCount; i++) {
    // Restore source order so warnings do not jump when the resource index changes.
    for (const j of [...index.related(i)].filter(j => j > i).sort((a, b) => a - b)) {
      if (overlaps(all[i], all[j])) { const p = index.pair(i, j); if (p.axes.length) result.push(p); }
    }
  }
  return result;
}
export function validate(draft: Draft) {
  const { items, incomplete } = lessons(draft), all = [...items, ...(draft.outside ?? [math])];
  const issues = currentPairs(all, items.length, conflictIndex(all)).map(p => issueOf(all, p));
  return { issues, incomplete: [...incomplete, ...draft.source?.uncertainties ?? []] };
}
export type Candidate = { revision: number; placementId: string; start: number; end: number; draft: Draft; label: string };
export function suggest(draft: Draft, placementId: string, revision: number): Candidate[] {
  const { items, incomplete } = lessons(draft), source = items.find(p => p.id === placementId);
  // 잠근 수업은 어떤 길로도 옮기지 않는다 — 추천도 내지 않는다.
  if (!source || source.locked || incomplete.length || draft.source?.uncertainties?.length || draft.placements.some(p => draft.cells[p.row]?.some(c => c.formula))) return [];
  const all = [...items, ...(draft.outside ?? [math])], index = conflictIndex(all);
  const existing = currentPairs(all, items.length, index);
  const baseline = new Set(existing.filter(p => all[p.a].id !== placementId && all[p.b].id !== placementId).map(p => pairKey(all, p)));
  // Cells are authoritative: if a malformed/imported draft shares a row, every placement on it moves.
  const changed = new Set(items.flatMap((p, i) => p.row === source.row ? [i] : []));
  if (existing.some(p => !changed.has(p.a) && !changed.has(p.b) && !baseline.has(pairKey(all, p)))) return [];
  const forbidden: Pair[] = [];
  for (const i of changed) for (const j of index.related(i)) {
    if (j === i || (changed.has(j) && j < i)) continue;
    const p = index.pair(Math.min(i, j), Math.max(i, j));
    if (p.axes.length && !baseline.has(pairKey(all, p))) forbidden.push(p);
  }
  const hoursByDay = operatingHoursOf(draft), hours = hoursByDay[source.day] ?? [];
  const bounded = draft.operatingHours ? draft : { ...draft, operatingHours: hoursByDay };
  const duration = source.end - source.start, step = draft.source?.step ?? 10;
  const starts: number[] = [];
  for (let start = Math.min(...hours.map(r => r.start)); start + duration <= Math.max(...hours.map(r => r.end)); start += Number.isInteger(step) && step > 0 ? step : 10) {
    const end = start + duration;
    if (start === source.start || !isOperatingTime(bounded, source.day, start, end)) continue;
    if (forbidden.some(p => {
      const a = all[p.a], b = all[p.b];
      return (changed.has(p.a) ? start : a.start) < (changed.has(p.b) ? end : b.end)
        && (changed.has(p.b) ? start : b.start) < (changed.has(p.a) ? end : a.end);
    })) continue;
    starts.push(start);
  }
  // Materialize only the three displayed choices, not a full copy for every tested time.
  return starts.sort((a, b) => Math.abs(a - source.start) - Math.abs(b - source.start) || a - b).slice(0, 3).map(start => ({
    revision, placementId, start, end: start + duration,
    draft: patchCells(draft, [
      { row: source.row, col: 2, cell: { ...draft.cells[source.row][2], text: timeLabel(start), richText: undefined } },
      { row: source.row, col: 3, cell: { ...draft.cells[source.row][3], text: timeLabel(start + duration), richText: undefined } },
    ]), label: `${source.day} ${timeLabel(start)}~${timeLabel(start + duration)} · 같은 강사·강의실`,
  }));
}
