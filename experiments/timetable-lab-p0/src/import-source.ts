import type { LabSource } from '../../../src/features/timetable-lab/types';
import { days, emptyDraft, timeMinutes, type Draft, type Lesson } from './model';

const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export function importSource(value: LabSource): Draft {
  if (value?.version !== 1 || value.subject !== 'english' || !value.tenantId || !Array.isArray(value.slots) || !Array.isArray(value.outside)
    || !Array.isArray(value.teacherOrder) || value.teacherOrder.some(t => typeof t !== 'string') || !Array.isArray(value.notices)) throw new Error('시간표 자료 형식이 올바르지 않습니다.');
  if (value.slots.length > 5000 || value.outside.length > 20000) throw new Error('시간표가 너무 큽니다. 불러올 주를 확인하세요.');
  const draft = emptyDraft(), seen = new Set<string>();
  function slot(s: LabSource['slots'][number], row: number): Lesson {
    const day = days[keys.indexOf(s.day)], start = timeMinutes(s.start), end = timeMinutes(s.end);
    if (!s.id || seen.has(s.id) || !s.name?.trim() || !['lesson', 'seat', 'block'].includes(s.kind) || (s.kind !== 'block' && !s.classId)
      || !day || start === null || end === null || end <= start || typeof s.teacher !== 'string' || typeof s.room !== 'string'
      || !Array.isArray(s.students) || s.students.some(p => !p.id || typeof p.name !== 'string')) throw new Error('일부 수업의 식별자·요일·시간을 확인할 수 없어 불러오기를 중단했습니다.');
    seen.add(s.id);
    for (const student of s.students) draft.people![student.id] = student.name;
    return { id: `source:${s.id}`, sourceScheduleId: s.id, classId: s.classId, row,
      teacherId: s.teacherId, roomId: s.roomId, kind: s.kind, studentIds: s.students.map(p => p.id),
      name: s.name, day, start, end, teacher: s.teacher || '담당 미정', room: s.room, students: s.students.map(p => p.id) };
  }
  for (const s of value.slots) {
    const p = slot(s, draft.cells.length);
    const { id, sourceScheduleId, classId, row, teacherId, roomId, kind, studentIds } = p;
    draft.placements.push({ id, sourceScheduleId, classId, row, teacherId, roomId, kind, studentIds, labSeparate: s.labSeparate });
    if (classId) (draft.classes ??= {})[classId] = { color: s.classColor ? { ...s.classColor } : undefined, homeroomTeacher: s.homeroomTeacher };
    draft.cells.push([s.name, p.day, s.start, s.end, p.teacher, s.room].map(text => ({ text })));
    if (s.classId) draft.students[s.classId] = [...new Set([...(draft.students[s.classId] ?? []), ...p.students])];
  }
  draft.outside = value.outside.map(s => slot(s, -1));
  draft.appearance = value.appearance ? structuredClone(value.appearance) : undefined;
  draft.source = { kind: 'live', date: value.referenceDate, tenantId: value.tenantId, loadedAt: value.fetchedAt,
    academy: value.academy, notices: value.notices, uncertainties: value.uncertainties, step: [5, 10, 15, 20, 30, 60].includes(value.stepMinutes) ? value.stepMinutes : 10, teacherOrder: value.teacherOrder };
  return draft;
}
