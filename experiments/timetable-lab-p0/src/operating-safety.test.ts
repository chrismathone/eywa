import { describe, expect, it } from 'vitest';
import { defaultAppearance } from './appearance';
import { moveBlocks } from './block-commands';
import { captureOperatingHours, isAllowedTime, isOperatingTime, resizeLesson } from './operating-times';
import { emptyDraft, lessons, type Lesson } from './model';

describe('actual lesson operating windows', () => {
  it('does not turn an early staff meeting into available student lesson hours', () => {
    const draft = emptyDraft(); draft.appearance = structuredClone(defaultAppearance);
    draft.appearance.periods = { weekday: { '1': { startTime: '14:00', endTime: '15:00' } },
      weekdayBySubject: { english: { '1': { startTime: '14:00', endTime: '15:00' } } }, weekend: {} };
    const original: Lesson = { id: 'meeting', sourceScheduleId: 'meeting', classId: '', row: 1,
      kind: 'block', name: '강사 회의', day: '월', start: 540, end: 600, teacher: '강사 가', room: '', students: [] };
    draft.operatingHours = captureOperatingHours(draft, [original]);
    expect(isOperatingTime(draft, '월', 540, 600)).toBe(false);
    expect(isOperatingTime(draft, '월', 840, 900)).toBe(true);
    draft.operatingHours = captureOperatingHours(draft, [{ ...original, kind: 'lesson', classId: 'early', name: '실제 오전 수업' }]);
    expect(isOperatingTime(draft, '월', 540, 600)).toBe(true);
  });
  it('edits a meeting outside lesson hours by form or drag, yet never widens the hours for lessons', () => {
    const draft = emptyDraft(); draft.appearance = structuredClone(defaultAppearance);
    draft.appearance.periods = { weekday: { '1': { startTime: '14:00', endTime: '15:00' } },
      weekdayBySubject: { english: { '1': { startTime: '14:00', endTime: '15:00' } } }, weekend: {} };
    const row = (cells: string[]) => { draft.cells.push(cells.map(text => ({ text }))); return draft.cells.length - 1; };
    draft.placements = [
      { id: 'meeting', sourceScheduleId: null, classId: '', kind: 'block', row: row(['강사 회의', '월', '09:00', '10:00', '강사 가', '']) },
      { id: 'lesson', sourceScheduleId: null, classId: 'class-a', row: row(['영어 A', '월', '14:00', '15:00', '강사 가', '301']) },
    ];
    draft.operatingHours = captureOperatingHours(draft, lessons(draft).items);
    const times = (value: typeof draft, id: string) => { const p = lessons(value).items.find(item => item.id === id)!; return [p.start, p.end]; };
    const longer = resizeLesson(draft, 'meeting', 540, 630);
    expect(times(longer, 'meeting')).toEqual([540, 630]);
    expect(times(moveBlocks(longer, ['meeting'], 'meeting', { day: '월', teacher: '강사 가', start: 600 }), 'meeting')).toEqual([600, 690]);
    expect(isAllowedTime(longer, 'block', '월', 540, 630)).toBe(true); expect(isAllowedTime(longer, 'lesson', '월', 540, 630)).toBe(false);
    for (const [start, end] of [[600, 600], [700, 600], [-10, 60], [1400, 1440], [NaN, 600]]) expect(() => resizeLesson(draft, 'meeting', start, end)).toThrow();
    expect(() => resizeLesson(longer, 'lesson', 540, 600)).toThrow(); expect(isOperatingTime(longer, '월', 540, 600)).toBe(false);
    expect(times(draft, 'meeting')).toEqual([540, 600]);
  });
});
