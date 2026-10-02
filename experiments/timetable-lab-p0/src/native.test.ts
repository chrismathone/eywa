import { describe, expect, it } from 'vitest';
import { makeFixture, lessons, patchCells } from './model';
import { moveBlocks, copyBlocks } from './block-commands';
import { moveStudent } from './student-command';
import { importSource } from './import-source';
import { overlapLayout } from './overlap-layout';
import { validate } from './constraints';
import { DraftStore } from './store';
import { sourceFixture } from '../tests/source-fixture';

describe('native timetable commands', () => {
  it('keeps imported source IDs and all placements, including missing rooms and weekends', () => {
    const draft = importSource(sourceFixture());
    expect(lessons(draft).items).toHaveLength(5);
    expect(draft.placements[0].sourceScheduleId).toBe('schedule-0');
    expect(draft.placements[0]).not.toHaveProperty('start'); // No second, stale copy of cell-derived semantics.
    expect(lessons(draft).items.at(-1)?.day).toBe('일');
    expect(validate(draft).incomplete).toHaveLength(1);
    expect(draft.outside?.[0].students).toEqual(['s1']);
  });
  it('rejects a partial or duplicate import atomically', () => {
    const source = sourceFixture(); source.slots[1].id = source.slots[0].id;
    const store = new DraftStore(); expect(() => store.commit('import', importSource(source))).toThrow();
    expect(store.getSnapshot().draft).toEqual(makeFixture()); expect(store.getSnapshot().revision).toBe(0);
  });
  it('moves a group across time and day in one undo without changing sources or students', () => {
    const store = new DraftStore(), before = store.getSnapshot().draft;
    store.commit('move', moveBlocks(before, ['placement-1', 'placement-2'], 'placement-1', { day: '화', teacher: '강사 나', start: 1110 }));
    const items = lessons(store.getSnapshot().draft).items;
    expect(items.slice(0, 2).map(p => [p.day, p.start, p.teacher])).toEqual([['화', 1110, '강사 나'], ['수', 1110, '강사 나']]);
    expect(items[0].sourceScheduleId).toBe('schedule-1'); expect(items[0].students).toEqual(['s1']);
    store.undo(); expect(store.getSnapshot().draft).toEqual(before);
    store.redo(); expect(lessons(store.getSnapshot().draft).items[0].start).toBe(1110);
  });
  it('rejects out of range or non-finite moves without partial mutation', () => {
    const draft = makeFixture(), before = structuredClone(draft);
    for (const start of [-60, 1430, NaN, Infinity]) expect(() => moveBlocks(draft, ['placement-1'], 'placement-1', { day: '월', teacher: '강사 나', start })).toThrow();
    expect(draft).toEqual(before);
  });
  it('copies with fresh identities; source move replaces stale formula data', () => {
    const draft = patchCells(makeFixture(), [{ row: 1, col: 2, cell: { text: '18:00', formula: '=1', richText: { old: true }, bold: true } }]);
    const moved = moveBlocks(draft, ['placement-1'], 'placement-1', { day: '화', start: 1000, teacher: '강사 나' });
    expect(moved.cells[1][2]).toEqual({ text: '16:40', formula: undefined, richText: undefined, bold: true });
    const next = copyBlocks(draft, [lessons(draft).items[0]], 'placement-1', { day: '수', teacher: '강사 나', start: 1000 });
    expect(next.placements.at(-1)?.sourceScheduleId).toBeNull(); expect(next.placements.at(-1)?.id).not.toBe('placement-1');
    expect(next.placements.at(-1)).not.toHaveProperty('teacher');
    expect(next.placements[0]).toEqual(draft.placements[0]);
  });
  it('student move affects only the two selected placements and undoes together', () => {
    const draft = importSource(sourceFixture()), before = structuredClone(draft);
    const next = moveStudent(draft, 's1', 'source:schedule-0', 'source:schedule-1');
    expect(lessons(next).items[0].students).toEqual([]); expect(lessons(next).items[1].students).toEqual(['s2', 's1']);
    expect(lessons(next).items[2].students).toEqual(['s1']); expect(next.outside).toEqual(draft.outside); expect(draft).toEqual(before);
    const store = new DraftStore(draft); store.commit('student', next); store.undo(); expect(store.getSnapshot().draft).toEqual(before);
  });
  it('assigns stable lanes for an overlap chain without covering or overflowing blocks', () => {
    const item = lessons(makeFixture()).items[0];
    const items = [[0, 30], [20, 60], [40, 90]].map(([start, end], n) => ({ ...item, id: String(n), start, end }));
    const layout = overlapLayout(items);
    expect([...layout.values()]).toEqual([{ left: 0, width: 50 }, { left: 50, width: 50 }, { left: 0, width: 50 }]);
  });
});
