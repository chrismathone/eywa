import { days, timeLabel, type Draft, type Lesson } from './model';
import { appearanceOf } from './appearance';
import { buildTenMinuteRows, buildSlotIntervals, breakBlocksForColumn, parseBreakRanges } from '@/features/timetable/lib/ten-minute-grid';
import { weekdayTableFor } from '@/features/timetable/lib/periods';
import { overlapLayout } from './overlap-layout';
import { teacherColumns } from './teachers';

export function teacherLayout(draft: Draft, all: Lesson[], zoom: number) {
  const appearance = appearanceOf(draft), step = draft.source?.step ?? 10;
  const teachers = teacherColumns(draft, all);
  const floor = Math.min(...Object.values(weekdayTableFor('english', appearance.periods)).map(p => {
    const [h, m] = p.startTime.split(':').map(Number); return h * 60 + m;
  }));
  const clampMorning = Number.isFinite(floor) && all.some(p => p.start >= floor);
  const lanes = teachers.flatMap(teacher => days.filter(day => {
    const used = all.some(p => p.teacher === teacher && p.day === day);
    // 수업이 하나도 없는 강사 열(방금 더한 강사)은 접지 않는다 — 평일 칸이 있어야 수업을 놓을 수 있다.
    if (!all.some(p => p.teacher === teacher)) return day !== '토' && day !== '일';
    // 수업이 있는 요일은 어떤 보기 설정으로도 감추지 않는다 — 안 보이는 수업이 겹침을 만들면 찾을 길이 없다.
    if (used) return true;
    if (appearance.hideEmptyDays) return false;
    return day === '토' ? !appearance.hideSaturday : day === '일' ? !!appearance.showSunday : true;
  }).map(day => {
    const items = all.filter(p => p.teacher === teacher && p.day === day);
    // Visual shift follows the operating teacher view; actual times remain intact.
    const early = items.filter(p => p.start < floor);
    const offset = clampMorning && early.length ? floor - Math.min(...early.map(p => p.start)) : 0;
    const offsets = new Map(items.map(p => [p.id, p.start < floor ? offset : 0]));
    const displayed = items.map(p => ({ ...p, start: p.start + offsets.get(p.id)!, end: p.end + offsets.get(p.id)! }));
    const layout = overlapLayout(displayed);
    const columns = Math.max(1, ...[...layout.values()].map(p => Math.round(100 / p.width)));
    return { teacher, day, items, displayed, offset, offsets, layout, width: Math.max(65, columns * 64) * zoom };
  }));
  const allRows = buildTenMinuteRows(lanes.flatMap(l => l.displayed.map(p => ({ startTime: timeLabel(p.start), endTime: timeLabel(p.end) }))), undefined, step);
  const rows = clampMorning ? allRows.filter(r => r.startMin >= floor) : allRows;
  const min = rows[0]?.startMin ?? 860, max = (rows.at(-1)?.startMin ?? 1310) + step;
  const unit = Math.max(4, Math.round(step * appearance.pxPerMin * zoom));
  const breaks = parseBreakRanges(appearance.breaks, step);
  const withBreaks = lanes.map(l => ({ ...l, breaks: breakBlocksForColumn(rows, buildSlotIntervals(l.displayed.map(p => ({ ...p,
    startTime: timeLabel(p.start), endTime: timeLabel(p.end) })), step), breaks) }));
  return { teachers, lanes: withBreaks, rows, min, max, step, unit, height: rows.length * unit };
}
