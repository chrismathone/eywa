import { days, emptyDraft, lessons, timeLabel, type Draft } from './model';

/** Entirely synthetic: 240 classes × 5 weekdays × 20 students; no operating data. */
export function largeDraft(classCount = 240, rosterSize = 20): Draft {
  const draft = emptyDraft();
  draft.operatingHours = Object.fromEntries(days.map(day => [day, [{ start: 540, end: 1320 }]]));
  for (let c = 0; c < classCount; c++) {
    const classId = `class-${c}`, teacher = `teacher-${c % 40}`, room = `room-${c % 60}`;
    draft.students[classId] = Array.from({ length: rosterSize }, (_, s) => `student-${c}-${s}`);
    for (const day of days.slice(0, 5)) {
      const row = draft.cells.length, start = 540 + c % 10 * 60;
      draft.cells.push([classId, day, timeLabel(start), timeLabel(start + 40), teacher, room].map(text => ({ text })));
      draft.placements.push({ id: `placement-${row}`, classId, sourceScheduleId: `source-${row}`, row, teacherId: teacher, roomId: room });
    }
  }
  return draft;
}

/** Deterministic fuzz cases cover identity/label fallback, seats, duplicate IDs and shared rows. */
export function variedDraft(seed: number): Draft {
  let state = seed;
  const random = (max: number) => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state % max; };
  const draft = emptyDraft();
  draft.operatingHours = Object.fromEntries(days.map(day => [day, [{ start: 540, end: 720 }, { start: 780, end: 1020 }]]));
  for (let i = 0; i < 24; i++) {
    const row = draft.cells.length, start = 540 + random(45) * 10;
    const teacher = `teacher-${random(5)}`, room = `room-${random(5)}`, classId = `class-${i}`;
    draft.cells.push([classId, days[random(3)], timeLabel(start), timeLabel(start + 30 + random(4) * 10), teacher, room].map(text => ({ text })));
    draft.students[classId] = Array.from({ length: random(6) }, () => `student-${random(12)}`);
    draft.placements.push({ id: `placement-${i}`, classId, sourceScheduleId: null, row,
      teacherId: random(3) ? `teacher-id-${random(4)}` : null,
      roomId: random(3) ? `room-id-${random(4)}` : null, kind: ['lesson', 'seat', 'block'][random(3)] as 'lesson' | 'seat' | 'block' });
  }
  draft.outside = lessons(draft).items.slice(-4).map((p, i) => ({ ...p, id: i === 0 ? 'placement-0' : `outside-${i}`, row: -1 }));
  if (seed % 2 === 0) draft.placements[1].row = draft.placements[0].row;
  return draft;
}

/** Old full-snapshot history retained only as a benchmark baseline. */
export class ReferenceStore {
  past: { before: Draft; after: Draft }[] = [];
  draft: Draft;
  constructor(draft: Draft) { this.draft = structuredClone(draft); }
  commit(next: Draft) {
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    this.past.push({ before: structuredClone(this.draft), after: structuredClone(next) });
    this.draft = structuredClone(next);
  }
}
