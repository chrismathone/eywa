import { describe, expect, it } from 'vitest';
import { classList, mergeClasses, moveClassStudent, renameClass, splitClass } from './class-commands';
import { compareDrafts } from './draft-comparison';
import { lessons, makeFixture } from './model';
import { moveBlocks } from './block-commands';
import { captureOperatingHours, isOperatingTime, resizeLesson } from './operating-times';
import { DraftStore } from './store';
import { integratedProjection } from './integrated-projection';
import { moveNote } from './student-marks';
import { defaultAppearance } from './appearance';
function weekly() {
  const draft = makeFixture(); draft.students['class-1'] = ['s1', 's2'];
  draft.cells.push(draft.cells[1].map(c => ({ ...c }))); draft.cells.at(-1)![1].text = '금';
  draft.placements.push({ ...draft.placements[0], id: 'friday', row: draft.cells.length - 1, studentIds: ['s1'] });
  draft.outside = [{ ...lessons(draft).items[0], id: 'math', classId: 'math', teacher: '수학 강사' }];
  draft.appearance = structuredClone(defaultAppearance);
  draft.appearance.groups = { groups: [{ id: 'group', title: '영어', classIds: ['class-1', 'class-2', 'class-3'] }], showOthers: false, othersTitle: '기타' };
  return draft;
}
describe('practice class editing', () => {
  it('renames every day with stable IDs, projects both cards, and undoes atomically', () => {
    const store = new DraftStore(weekly()), before = store.getSnapshot().draft;
    store.commit('rename', renameClass(before, 'class-1', '새 반 이름'));
    expect(lessons(store.getSnapshot().draft).items.filter(p => p.classId === 'class-1').map(p => p.name)).toEqual(['새 반 이름', '새 반 이름']);
    expect(store.getSnapshot().draft.placements).toEqual(before.placements);
    expect(integratedProjection(store.getSnapshot().draft).groups[0].cards[0].className).toBe('새 반 이름');
    store.undo(); expect(store.getSnapshot().draft).toEqual(before);
    expect(() => renameClass(before, 'class-1', '영어 B')).toThrow(); expect(() => renameClass(before, 'class-1', ' ')).toThrow();
  });
  it('moves from all source days to all target days without touching another class or math', () => {
    const source = weekly(), store = new DraftStore(source), before = store.getSnapshot().draft;
    store.commit('roster', moveClassStudent(before, 's1', 'class-1', 'class-2'));
    const next = store.getSnapshot().draft, items = lessons(next).items;
    expect(items.filter(p => p.classId === 'class-1').every(p => !p.students.includes('s1'))).toBe(true);
    expect(items.find(p => p.classId === 'class-2')?.students).toEqual(['s2', 's1']);
    expect(next.outside).toEqual(before.outside); expect(next.students['class-3']).toEqual(['s3']);
    expect(moveNote(next, 'class-2', 's1')).toContain('영어 A');
    const back = moveClassStudent(next, 's1', 'class-2', 'class-1'); expect(moveNote(back, 'class-1', 's1')).toBeUndefined();
    store.undo(); expect(store.getSnapshot().draft).toEqual(before); store.redo(); expect(store.getSnapshot().draft).toEqual(next);
  });
  it('merges into the chosen schedule with deduped roster and restores all source rows on undo', () => {
    const store = new DraftStore(weekly()), before = store.getSnapshot().draft;
    store.commit('merge', mergeClasses(before, 'class-1', 'class-2'));
    const next = store.getSnapshot().draft, items = lessons(next).items;
    expect(items.map(p => p.id)).toEqual(['placement-2', 'placement-3']);
    expect(items[0].students).toEqual(['s2', 's1']); expect(items[0].sourceScheduleId).toBe('schedule-2');
    expect(next.appearance?.groups?.groups[0].classIds).toEqual(['class-2', 'class-3']);
    expect(next.outside).toEqual(before.outside); expect(moveNote(next, 'class-2', 's1')).toContain('영어 A');
    store.undo(); expect(store.getSnapshot().draft).toEqual(before);
  });
  it('splits by student keeping attendance days, colors, group visibility, new source-free IDs', () => {
    const draft = weekly(); draft.classes = { 'class-1': { color: { bg: '#123456', text: '#ffffff' }, homeroomTeacher: '강사 가' } };
    const store = new DraftStore(draft), before = store.getSnapshot().draft;
    store.commit('split', splitClass(before, 'class-1', '영어 A 심화', ['s2']));
    const next = store.getSnapshot().draft, created = classList(next).find(c => c.name === '영어 A 심화')!;
    expect(created.items.map(p => [p.day, p.students])).toEqual([['월', ['s2']], ['금', []]]);
    expect(created.items.every(p => p.sourceScheduleId === null && !before.placements.some(b => b.id === p.id))).toBe(true);
    expect(classList(next).find(c => c.id === 'class-1')?.students).toEqual(['s1']);
    expect(next.classes?.[created.id].color).toEqual(before.classes?.['class-1'].color);
    expect(next.appearance?.groups?.groups[0].classIds[1]).toBe(created.id); expect(integratedProjection(next).hiddenClasses).toEqual([]);
    expect(moveNote(next, created.id, 's2')).toContain('영어 A');
    store.undo(); expect(store.getSnapshot().draft).toEqual(before);
    expect(() => splitClass(before, 'class-1', '새 반', ['s1', 's2'])).toThrow(); expect(() => splitClass(before, 'class-1', '새 반', ['unknown'])).toThrow();
  });
  it('compares semantic changes by ID without changing either draft', () => {
    const before = weekly(), after = renameClass(moveClassStudent(before, 's1', 'class-1', 'class-2'), 'class-1', '영어 새 반');
    const differences = compareDrafts(before, after);
    expect(differences.map(c => c.id)).toEqual(['placement-1', 'placement-2', 'friday']);
    expect(differences[0].details.join(' ')).toContain('반 이름'); expect(differences[1].details.join(' ')).toContain('새로 배정: 학생 가');
    expect(compareDrafts(after, structuredClone(after))).toEqual([]); expect(before.cells[1][0].text).toBe('영어 A');
  });
});
describe('operating hours and flexible lesson lengths', () => {
  it('allows 40 to 60 minutes and preserves source identity/roster, but rejects close time and gaps', () => {
    const draft = weekly(), before = structuredClone(draft);
    const forty = resizeLesson(draft, 'placement-1', 1080, 1120), sixty = resizeLesson(forty, 'placement-1', 1080, 1140);
    expect(lessons(forty).items[0].end - lessons(forty).items[0].start).toBe(40);
    expect(sixty.placements).toEqual(draft.placements); expect(sixty.students).toEqual(draft.students);
    for (const [start, end] of [[1300, 1330], [1200, 1230], [1080, 1080], [NaN, 1140], [1080, 1440]]) expect(() => resizeLesson(draft, 'placement-1', start, end)).toThrow();
    expect(() => moveBlocks(draft, ['placement-1'], 'placement-1', { day: '토', start: 1080, teacher: '강사 가' })).toThrow();
    expect(draft).toEqual(before);
  });
  it('freezes imported morning exceptions without expanding hours from later edits', () => {
    const draft = weekly(); draft.cells[1][2].text = '10:00'; draft.cells[1][3].text = '11:00';
    draft.operatingHours = captureOperatingHours(draft, lessons(draft).items);
    expect(isOperatingTime(draft, '월', 600, 660)).toBe(true); expect(isOperatingTime(draft, '화', 600, 660)).toBe(false);
    expect(() => resizeLesson(draft, 'placement-1', 600, 670)).toThrow();
  });
});
