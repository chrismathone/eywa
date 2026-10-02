import { outsideOf } from './constraints';
import { lessons, type Draft } from './model';
import { operatingHoursOf } from './operating-times';

export type Band = { start: number; end: number };
export const laneKey = (teacher: string, day: string) => `${teacher}|${day}`;
/**
 * 한 수업을 **겹침 없이** 놓을 수 있는 자리를 칸(강사·요일)마다 구한다. 끄는 동안 초록으로 칠해 보여 준다.
 * 강사·강의실·학생이 겹치지 않고 운영시간 안인 시작 시각을 이어 붙인 띠다.
 * 놓는 것 자체는 어디든 자유다 — 이것은 안내일 뿐이고, 놓기 직전의 정확한 판정은 `previewMove`가 한다.
 */
export function freeBands(draft: Draft, id: string, lanes: { teacher: string; day: string }[]): Map<string, Band[]> {
  const all = lessons(draft).items, item = all.find(p => p.id === id), result = new Map<string, Band[]>();
  if (!item || item.locked) return result;
  const others = [...all, ...outsideOf(draft)].filter(p => p.id !== id), mine = new Set(item.students);
  const duration = item.end - item.start, hours = operatingHoursOf(draft);
  const step = Number.isInteger(draft.source?.step) && draft.source!.step > 0 ? draft.source!.step : 10;
  // 자리(LAB·JJ) 열에 놓으면 자리 수업이 된다 — 강사·강의실 겹침은 따지지 않고 학생만 본다(겹침 검사와 같은 규칙).
  const seats = new Set(all.filter(p => p.kind === 'seat').map(p => p.teacher));
  for (const lane of lanes) {
    const seat = seats.has(lane.teacher);
    if (seat && item.kind === 'block') continue;
    const busy = others.filter(p => p.day === lane.day && (p.students.some(s => mine.has(s))
      || (!seat && p.kind !== 'seat' && (p.teacher === lane.teacher || (!!item.room && p.room === item.room)))));
    const ranges = item.kind === 'block' ? [{ start: 0, end: 1439 }] : hours[lane.day] ?? [], bands: Band[] = [];
    for (const range of ranges) for (let start = range.start; start + duration <= range.end; start += step) {
      if (busy.some(p => p.start < start + duration && start < p.end)) continue;
      const last = bands.at(-1);
      if (last && start - step === last.end - duration) last.end = start + duration; else bands.push({ start, end: start + duration });
    }
    if (bands.length) result.set(laneKey(lane.teacher, lane.day), bands);
  }
  return result;
}
