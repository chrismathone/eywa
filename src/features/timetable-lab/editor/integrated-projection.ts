import { buildRichCardGroups, type GridSlot, type GridStudent } from '@/features/timetable/lib/class-grid';
import { koDayToEnum } from '@/features/timetable/lib/periods';
import { labelsOf, lessons, timeLabel, type Draft } from './model';
import { appearanceOf } from './appearance';

/** Both views project the same placements; the production grouping/period logic is shared. */
export function integratedProjection(draft: Draft) {
  const all = lessons(draft).items.filter(p => p.kind !== 'block'), people = labelsOf(draft), appearance = appearanceOf(draft);
  const rosters = new Map<string, Map<string, Set<string>>>();
  for (const p of all) {
    const roster = rosters.get(p.classId) ?? new Map<string, Set<string>>();
    for (const id of p.students) { const attendance = roster.get(id) ?? new Set<string>(); attendance.add(koDayToEnum(p.day)!); roster.set(id, attendance); }
    rosters.set(p.classId, roster);
  }
  const students = new Map<string, GridStudent[]>([...rosters].map(([classId, roster]) => [classId, [...roster].map(([id, attendance]) => ({
    studentId: id, name: people[id] ?? '이름 미확인', grade: null, school: null, status: 'active', attendanceDays: [...attendance], isTransferredIn: !!draft.studentMoves?.[classId]?.[id],
  }))]));
  const slots: GridSlot[] = all.map(p => ({ sourceId: p.id, classId: p.classId, className: p.name, subject: 'english',
    dayOfWeek: koDayToEnum(p.day)!, startTime: timeLabel(p.start), endTime: timeLabel(p.end),
    teacherName: draft.classes?.[p.classId]?.homeroomTeacher ?? null, slotTeacherLabel: p.teacher,
    classroomName: p.room, slotRoomLabel: p.room, labSeparate: p.labSeparate || undefined,
    classBgColor: draft.classes?.[p.classId]?.color?.bg ?? null, classTextColor: draft.classes?.[p.classId]?.color?.text ?? null,
    students: students.get(p.classId) ?? [],
  }));
  const groups = buildRichCardGroups(slots, appearance.periods, new Set(appearance.compactSections), appearance.groups);
  const byClass = new Map<string, typeof all>();
  for (const item of all) { const group = byClass.get(item.classId) ?? []; group.push(item); byClass.set(item.classId, group); }
  const visible = new Set(groups.flatMap(g => g.cards.map(c => c.classId)));
  return { all, byId: new Map(all.map(p => [p.id, p])), byClass, groups, hiddenClasses: [...byClass.keys()].filter(id => !visible.has(id)) };
}
