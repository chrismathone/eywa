import { weekdayTableFor } from '../../../src/features/timetable/lib/periods';
import { appearanceOf } from './appearance';
import { days, lessons, patchCells, timeLabel, timeMinutes, type Draft, type Lesson } from './model';
type Range = { start: number; end: number };
/** Freeze operating periods and imported exceptions; editing never widens these hours. */
export function captureOperatingHours(draft: Draft, original: Lesson[] = []) {
  const config = appearanceOf(draft).periods;
  return Object.fromEntries(days.map((day, index) => {
    const table = index < 5 ? weekdayTableFor('english', config) : config.weekend;
    const ranges: Range[] = Object.values(table).flatMap(p => {
      const start = timeMinutes(p.startTime), end = timeMinutes(p.endTime);
      return start !== null && end !== null && start < end ? [{ start, end }] : [];
    });
    // Meetings and personal blocks are not evidence that student lessons operate at those hours.
    ranges.push(...original.filter(p => p.day === day && p.kind !== 'block').map(p => ({ start: p.start, end: p.end })));
    const merged: Range[] = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end); else merged.push({ ...range });
    }
    return [day, merged];
  }));
}
export const operatingHoursOf = (draft: Draft) => draft.operatingHours ?? captureOperatingHours(draft);
export const operatingLabel = (draft: Draft, day: string) => (operatingHoursOf(draft)[day] ?? []).map(r => `${timeLabel(r.start)}~${timeLabel(r.end)}`).join(', ') || '운영시간 없음';
export function isOperatingTime(draft: Draft, day: string, start: number, end: number) {
  return Number.isInteger(start) && Number.isInteger(end) && start < end && (operatingHoursOf(draft)[day] ?? []).some(r => start >= r.start && end <= r.end);
}
export function checkOperatingTime(draft: Draft, day: string, start: number, end: number) {
  if (!isOperatingTime(draft, day, start, end)) throw new Error(`${day}요일 운영시간(${operatingLabel(draft, day)}) 안에서 시작·종료 시간을 정해 주세요. 쉬는 시간만 있는 구간을 가로지를 수 없습니다.`);
}
/** Meetings follow the same rule as moving them: inside one day, not the student lesson hours. */
export function isAllowedTime(draft: Draft, kind: Lesson['kind'], day: string, start: number, end: number) {
  if (kind !== 'block') return isOperatingTime(draft, day, start, end);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end < 1440;
}
export function resizeLesson(draft: Draft, id: string, start: number, end: number): Draft {
  const item = lessons(draft).items.find(p => p.id === id);
  if (!item) throw new Error('시간을 바꿀 수업을 다시 선택해 주세요.');
  if (item.kind !== 'block') checkOperatingTime(draft, item.day, start, end);
  else if (!isAllowedTime(draft, item.kind, item.day, start, end)) throw new Error('하루 안에서 시작보다 늦은 종료 시간을 골라 주세요.');
  return patchCells(draft, [start, end].map((value, index) => ({ row: item.row, col: index + 2,
    cell: { ...draft.cells[item.row][index + 2], text: timeLabel(value), formula: undefined, richText: undefined } })));
}
