import { describe, expect, it } from 'vitest';
import { importSource } from './import-source';
import { sourceFixture } from './source-fixture.test-support';
import { lessons } from './model';
import { moveBlocks, copyBlocks } from './block-commands';
import { integratedProjection } from './integrated-projection';
import { teacherLayout } from './teacher-layout';
import { lessonTone, setPracticeColor } from './appearance';
import { DraftStore } from './store';

describe('operating view settings in an isolated practice draft', () => {
  it('imports configured colors, nicknames, homeroom and whole-week columns without aliasing the snapshot', () => {
    const source = sourceFixture(), draft = importSource(source), all = lessons(draft).items;
    expect(lessonTone(draft, all[0])).toEqual(source.slots[0].classColor);
    const grid = teacherLayout(draft, all, 1);
    expect(grid.lanes.filter(l => l.teacher === '강사 가').map(l => l.day)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    const card = integratedProjection(draft).groups.flatMap(g => g.cards)[0];
    expect(card.bgColor).toBe('#d9ead3'); expect(card.teacherName).toBe('강사 가');
    draft.appearance!.teacherColors['강사 가'].bg = '#000000';
    expect(source.appearance!.teacherColors['강사 가'].bg).toBe('#156542');
    draft.classes!['class-0'].color!.bg = '#000000';
    expect(source.slots[0].classColor!.bg).toBe('#d9ead3');
  });
  it('moving a lesson updates its integrated cell while source identity, color and roster persist', () => {
    const draft = importSource(sourceFixture()), first = lessons(draft).items[0];
    const next = moveBlocks(draft, [first.id], first.id, { day: '화', teacher: '강사 나', start: 1100 });
    const card = integratedProjection(next).groups.flatMap(g => g.cards).find(c => c.classId === first.classId)!;
    expect(Object.entries(card.cells).find(([, c]) => c.sourceIds?.includes(first.id))?.[0]).toMatch(/:tue$/);
    expect(Object.values(card.cells)[0].label).toBe('강사 나');
    expect(card.active[0].studentId).toBe('s1'); expect(card.bgColor).toBe('#d9ead3');
    expect(next.placements[0].sourceScheduleId).toBe(first.sourceScheduleId);
  });
  it('keeps both identities when free placement puts copies into the same integrated cell', () => {
    const draft = importSource(sourceFixture()), first = lessons(draft).items[0];
    const next = copyBlocks(draft, [first], first.id, { day: first.day, teacher: first.teacher, start: first.start });
    const card = integratedProjection(next).groups.flatMap(g => g.cards).find(c => c.classId === first.classId)!;
    expect(Object.values(card.cells).flatMap(c => c.sourceIds ?? [])).toHaveLength(2);
    expect(next.placements.at(-1)?.sourceScheduleId).toBeNull();
  });
  it('uses saved group order and preserves imported styles through one-step undo/redo', () => {
    const source = sourceFixture(); source.appearance!.groups = { groups: [{ id: 'custom', title: '연습', classIds: ['class-1', 'class-0'] }], showOthers: false, othersTitle: '' };
    const draft = importSource(source), projection = integratedProjection(draft);
    expect(projection.groups[0].cards.map(c => c.classId)).toEqual(['class-1', 'class-0']);
    expect(projection.hiddenClasses).toHaveLength(3);
    const store = new DraftStore(draft);
    store.commit('색', setPracticeColor(draft, 'teacher', '강사 가', { bg: '#123456', text: '#ffffff' }));
    expect(store.getSnapshot().draft.appearance!.teacherColors['강사 가'].bg).toBe('#123456');
    store.undo(); expect(store.getSnapshot().draft.appearance!.teacherColors['강사 가'].bg).toBe('#156542');
    store.redo(); expect(store.getSnapshot().draft.appearance!.teacherColors['강사 가'].bg).toBe('#123456');
  });
  it('shifts morning lessons for display only and never drops their actual times', () => {
    const source = sourceFixture(); source.slots[3].start = '10:00'; source.slots[3].end = '11:00';
    source.slots.push({ ...source.slots[3], id: 'afternoon', start: '18:00', end: '19:00' });
    const draft = importSource(source), all = lessons(draft).items, grid = teacherLayout(draft, all, 1);
    expect(grid.lanes.find(l => l.day === '토' && l.items.length)?.offset).toBe(260);
    expect(all.find(p => p.day === '토')?.start).toBe(600);
    expect(grid.lanes.find(l => l.day === '토' && l.items.length)?.displayed.find(p => p.id === 'source:afternoon')?.start).toBe(1080);
    expect(integratedProjection(draft).groups.flatMap(g => g.cards).some(c => Object.values(c.cells).some(cell => cell.time === '10:00~11:00'))).toBe(true);
  });
});
