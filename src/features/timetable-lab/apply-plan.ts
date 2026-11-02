import { lessons, labelsOf, timeLabel, timeMinutes, type Draft, type Lesson } from './editor/model';
import { classList } from './editor/class-commands';
import { koDayToEnum, enumDayToKo, settingsToPeriodsConfig, DEFAULT_PERIODS_CONFIG } from '@/features/timetable/lib/periods';
import { specialSlotLabel } from '@/features/timetable/lib/teacher-label';
import { captureOperatingHours, isAllowedTime } from './editor/operating-times';
import { appearanceOf } from './editor/appearance';
import { isAssignableTeacherRole, type SystemRole } from '@/lib/permissions';
import { validate } from './editor/constraints';
import { SUBJECT_END_VIA_REPORT } from '@/features/withdrawals/via-report';
import { isSpecialLecture } from '@/features/classes/special-lecture';
import type { ApplyContext, NativeClass, NativeEnrollment, NativeSchedule, NativeBlock } from './server/apply-context';

export type ApplyPlan = {
  schedules: { item: Lesson; before: NativeSchedule | null; day: string; teacherId: string | null; roomId: string | null; teacherLabel: string | null; roomLabel: string | null }[];
  removedSchedules: NativeSchedule[];
  blocks: { item: Lesson; before: NativeBlock | null; day: string; teacherId: string | null; teacherLabel: string }[];
  removedBlocks: NativeBlock[];
  classes: { id: string; name: string; before: NativeClass | null; teacherId: string | null; roomId: string | null; bg: string | null; text: string | null }[];
  closedClasses: NativeClass[];
  people: { id: string; name: string; beforeName: string }[];
  students: { id: string; name: string; beforeName: string | null; school: string | null; grade: string | null }[];
  enrollments: { before: NativeEnrollment | null; studentId: string; classId: string; days: string[]; remove: boolean }[];
  warnings: string[];
  summary: { schedules: number; blocks: number; classes: number; students: number; enrollments: number; teacherNames: number };
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const equalNames = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const personName = (context: ApplyContext, id: string | null) => context.people.find(person => person.id === id)?.name ?? '';

/** 운영 수업 행의 실제 담당 — 교시 강사 → 라벨 → 반 담임 순으로 읽는다. */
export function scheduleTeacher(row: NativeSchedule, context: ApplyContext) {
  const seat = specialSlotLabel(row.teacherLabel);
  if (seat) return { id: null, name: seat };
  const explicit = row.teacherLabel ? context.people.find(person => [person.name, person.englishName ?? ''].some(name => equalNames(name, row.teacherLabel!))) : undefined;
  const id = row.teacherId ?? explicit?.id ?? (row.teacherLabel ? null : context.classes.find(group => group.id === row.classId)?.teacherId) ?? null;
  return { id, name: personName(context, id) || row.teacherLabel || '담당 미정' };
}
export function scheduleRoom(row: NativeSchedule, context: ApplyContext) {
  const id = row.roomId ?? context.classes.find(group => group.id === row.classId)?.roomId ?? null;
  return { id, name: row.roomLabel || context.rooms.find(room => room.id === id)?.name || '' };
}
export function blockTeacher(row: NativeBlock, context: ApplyContext) {
  const id = row.teacherId ?? context.people.find(person => [person.name, person.englishName ?? ''].some(name => equalNames(name, row.teacherLabel)))?.id ?? null;
  return { id, name: personName(context, id) || row.teacherLabel };
}

/** 저장값을 그대로 실행하지 않는다. 지점의 실제 식별자·수강·배치와 비교해 변경 계획을 다시 만든다. */
export function buildApplyPlan(draft: Draft, context: ApplyContext, date: string): ApplyPlan {
  const source = draft.source;
  if (!source?.baselineHash || !source.importedIds || !source.importedClassIds || !source.initialStudents || !source.initialPlacements || !source.initialClasses) throw new Error('적용할 원본 버전이 없습니다. 기존 시간표를 다시 불러와 주세요.');
  // Client snapshots of other subjects are advisory only. Rebuild conflicts from the current tenant data.
  const outside: Lesson[] = (context.outside ?? []).filter(row => !row.validTo || row.validTo >= date).map(row => ({ id: row.id, sourceScheduleId: row.id, classId: row.classId, row: -1, name: row.name, day: enumDayToKo(row.day as Parameters<typeof enumDayToKo>[0]), start: timeMinutes(row.start)!, end: timeMinutes(row.end)!, teacher: row.teacher, teacherId: row.teacherId, room: row.room, roomId: row.roomId, students: row.students, kind: row.teacher === 'LAB' || row.teacher === 'JJ' ? 'seat' : 'lesson' }));
  const checks = validate({ ...draft, outside, source: { ...source, uncertainties: [] } });
  if (checks.incomplete.length) throw new Error(`미확정 항목을 먼저 수정해 주세요. ${checks.incomplete[0]}`);
  const all = lessons(draft).items, groups = classList(draft), names = labelsOf(draft);
  const plan: ApplyPlan = { schedules: [], removedSchedules: [], blocks: [], removedBlocks: [], classes: [], closedClasses: [], people: [], students: [], enrollments: [], warnings: checks.issues.map(issue => issue.message), summary: { schedules: 0, blocks: 0, classes: 0, students: 0, enrollments: 0, teacherNames: 0 } };
  const oldSchedules = new Map(context.schedules.map(row => [row.id, row])), oldBlocks = new Map(context.blocks.map(row => [row.id, row]));
  const imported = new Set(source.importedIds), oldClasses = new Map(context.classes.map(row => [row.id, row]));
  for (const id of imported) if (id.startsWith('block:') ? !oldBlocks.has(id.slice(6)) : !oldSchedules.has(id)) throw new Error('불러온 배치가 변경되었거나 다른 학원의 자료입니다. 다시 불러와 주세요.');
  for (const id of source.importedClassIds) if (!oldClasses.has(id)) throw new Error('불러온 반을 찾지 못했습니다. 다시 불러와 주세요.');
  const nativeItems: Lesson[] = context.schedules.filter(row => imported.has(row.id)).map(row => ({ id:row.id,sourceScheduleId:row.id,classId:row.classId,row:-1,name:'원본 수업',day:enumDayToKo(row.day as Parameters<typeof enumDayToKo>[0]),start:timeMinutes(row.start)!,end:timeMinutes(row.end)!,teacher:'',room:'',students:[],kind:'lesson' }));
  const operations = context.settings.operations as Parameters<typeof settingsToPeriodsConfig>[0] | undefined;
  const trusted: Draft = { ...draft, appearance:{ ...appearanceOf(draft), periods: operations ? settingsToPeriodsConfig(operations) : DEFAULT_PERIODS_CONFIG },operatingHours:undefined };
  trusted.operatingHours = captureOperatingHours(trusted,nativeItems);
  for (const item of all) if (!isAllowedTime(trusted,item.kind,item.day,item.start,item.end)) throw new Error(`${item.name}: 학원설정의 운영시간 또는 불러온 수업 시간 안에서 배치해 주세요.`);
  const renamed = new Map<string, string>();
  for (const item of all) {
    if (!item.teacherId) continue;
    if (item.sourceScheduleId && source.initialPlacements[item.sourceScheduleId]?.teacher===item.teacher) continue;
    const person = context.people.find(person => person.id === item.teacherId);
    if (!person) throw new Error('강사 정보를 다시 확인해 주세요.');
    if (![person.name, person.englishName ?? ''].some(name => equalNames(name, item.teacher)) && !context.people.some(other => [other.name, other.englishName ?? ''].some(name => equalNames(name, item.teacher)))) {
      if (renamed.has(person.id) && renamed.get(person.id) !== item.teacher) throw new Error('같은 강사의 이름이 서로 다르게 설정되어 있습니다.');
      renamed.set(person.id, item.teacher);
    }
  }
  for (const [id, name] of renamed) plan.people.push({ id, name, beforeName: context.people.find(person => person.id === id)!.name });
  const teacherId = (name: string) => {
    if (name === 'LAB' || name === 'JJ' || name === '담당 미정') return null;
    const matches = context.people.filter(person => person.status === 'active' && isAssignableTeacherRole(person.role as SystemRole) && [renamed.get(person.id) ?? person.name, person.englishName ?? ''].some(value => equalNames(value, name)));
    if (matches.length > 1) throw new Error(`${name}: 동명이인 강사를 확인해 주세요.`);
    return matches[0]?.id ?? null;
  };
  const roomId = (name: string) => context.rooms.filter(room => equalNames(room.name, name)).length === 1 ? context.rooms.find(room => equalNames(room.name, name))!.id : null;
  const liveSourceIds = new Set(all.map(item => item.sourceScheduleId).filter(Boolean));
  if (liveSourceIds.size !== all.filter(item => item.sourceScheduleId).length) throw new Error('같은 원본 배치가 중복되어 있습니다. 복제한 수업의 원본 연결을 확인해 주세요.');
  for (const id of imported) {
    if (liveSourceIds.has(id)) continue;
    if (id.startsWith('block:')) plan.removedBlocks.push(oldBlocks.get(id.slice(6))!); else plan.removedSchedules.push(oldSchedules.get(id)!);
  }
  for (const item of all) {
    if (item.sourceScheduleId && !imported.has(item.sourceScheduleId)) throw new Error('불러온 범위 밖의 배치는 적용할 수 없습니다. 다시 불러와 주세요.');
    const day = koDayToEnum(item.day);
    if (!day) throw new Error('수업 요일을 확인해 주세요.');
    const original = item.sourceScheduleId ? source.initialPlacements[item.sourceScheduleId] : undefined;
    if (item.sourceScheduleId && item.sourceScheduleId.startsWith('block:') !== (item.kind==='block')) throw new Error('수업과 비수업 일정의 원본 연결을 확인해 주세요.');
    const native = item.sourceScheduleId && item.kind!=='block' ? oldSchedules.get(item.sourceScheduleId) : undefined;
    const inheritanceChanged = !!native && !native.teacherId && !native.teacherLabel && (native.classId!==item.classId || source.initialClasses[item.classId]?.homeroomTeacher!==draft.classes?.[item.classId]?.homeroomTeacher);
    if (!inheritanceChanged && original && original.classId===item.classId && original.name===item.name && original.day===item.day && original.start===item.start && original.end===item.end && original.teacher===item.teacher && original.room===item.room && original.labSeparate===!!item.labSeparate) continue;
    let who = teacherId(item.teacher);
    if (item.kind === 'block') {
      const before = item.sourceScheduleId ? oldBlocks.get(item.sourceScheduleId.replace(/^block:/, ''))! : null;
      const oldBlockTeacher = before ? blockTeacher(before, context) : null, beforeWho = oldBlockTeacher?.id ?? null, beforeName = oldBlockTeacher?.name;
      const preserveTeacher = !!before && !!original && original.teacher===item.teacher;
      const label = before && original?.name===item.name ? before.label : item.name;
      if (preserveTeacher || beforeName === item.teacher) who = beforeWho;
      if (!before || before.day !== day || before.start !== timeLabel(item.start) || before.end !== timeLabel(item.end) || beforeWho !== who || before.label !== label || (!preserveTeacher && beforeName !== item.teacher)) plan.blocks.push({ item:{...item,name:label}, before, day, teacherId: preserveTeacher ? before.teacherId : who, teacherLabel: preserveTeacher ? before.teacherLabel : item.teacher });
      continue;
    }
    const before = item.sourceScheduleId ? oldSchedules.get(item.sourceScheduleId)! : null;
    const oldTeacher = before ? scheduleTeacher(before, context) : null;
    const oldRoom = before ? scheduleRoom(before, context) : null, oldRoomId = oldRoom?.id ?? null, oldRoomName = oldRoom?.name ?? '';
    const preserveTeacher = !!before && !!original && original.teacher===item.teacher, preserveRoom = !!before && !!original && original.room===item.room;
    const wanted: Lesson = { ...item, ...(preserveTeacher ? {teacher:oldTeacher!.name,teacherId:oldTeacher!.id}:{}), ...(preserveRoom ? {room:oldRoomName,roomId:oldRoomId}:{}),labSeparate:(preserveTeacher?oldTeacher!.name:item.teacher)==='LAB' && (original?.labSeparate===!!item.labSeparate ? !!before?.labSeparate : !!item.labSeparate) };
    if (preserveTeacher || oldTeacher?.name===wanted.teacher) who=oldTeacher!.id;
    const freezeRoom = !!before && before.classId!==item.classId && !before.roomId && !before.roomLabel;
    const writeTeacherId = preserveTeacher && !inheritanceChanged ? before!.teacherId : who;
    const writeTeacherLabel = preserveTeacher && !inheritanceChanged ? before!.teacherLabel : wanted.teacher;
    const writeRoomId = preserveRoom && !freezeRoom ? before!.roomId : roomId(wanted.room);
    const writeRoomLabel = preserveRoom && !freezeRoom ? before!.roomLabel : wanted.room || null;
    if (inheritanceChanged || !before || before.classId !== wanted.classId || before.day !== day || before.start !== timeLabel(wanted.start) || before.end !== timeLabel(wanted.end) || oldTeacher?.id !== who || oldTeacher.name !== wanted.teacher || oldRoomName !== wanted.room || !!before.labSeparate !== !!wanted.labSeparate) plan.schedules.push({ item:wanted, before, day, teacherId:writeTeacherId, roomId:writeRoomId,teacherLabel:writeTeacherLabel,roomLabel:writeRoomLabel });
  }
  const classNames = new Set<string>();
  for (const group of groups) {
    if (!UUID.test(group.id) || !group.name.trim() || group.name.length > 80) throw new Error('반 이름과 식별자를 확인해 주세요.');
    if (classNames.has(group.name)) throw new Error(`${group.name}: 같은 이름의 반이 두 개입니다.`);
    classNames.add(group.name);
    const before = oldClasses.get(group.id) ?? null, info = draft.classes?.[group.id];
    if (before && !source.importedClassIds.includes(before.id)) throw new Error('불러온 범위 밖의 반은 적용할 수 없습니다.');
    if (context.classes.some(other => other.id !== group.id && other.name === group.name && !groups.some(group => group.id === other.id && group.name !== other.name))) throw new Error(`${group.name}: 기존 반과 이름이 겹칩니다.`);
    const original = source.initialClasses[group.id];
    const changedName = !original || original.name!==group.name, changedTeacher = !original || original.homeroomTeacher!==info?.homeroomTeacher, changedColor = !original || !same(original.color??null,info?.color??null);
    if (before && !changedName && !changedTeacher && !changedColor) continue;
    const who = !changedTeacher && before ? before.teacherId : info?.homeroomTeacher ? info.homeroomTeacher === personName(context, before?.teacherId ?? null) ? before!.teacherId : teacherId(info.homeroomTeacher) : before?.teacherId ?? group.items[0]?.teacherId ?? null;
    if (changedTeacher && info?.homeroomTeacher && !who) throw new Error(`${group.name}: 담임은 직원관리에서 등록된 강사를 선택해 주세요.`);
    const name = changedName ? group.name : before!.name;
    const color = changedColor ? info?.color : undefined, bg = color?.bg ?? before?.bg ?? null, text = color?.text ?? before?.text ?? null;
    const room = before?.roomId ?? roomId(group.items[0]?.room ?? '');
    if (!before || before.name !== name || before.teacherId !== who || before.bg !== bg || (before.text ?? '#121212') !== (text ?? '#121212')) plan.classes.push({ id: group.id, name, before, teacherId: who, roomId: room, bg, text });
  }
  const classIds = new Set(groups.map(group => group.id));
  plan.closedClasses = source.importedClassIds.filter(id => !classIds.has(id)).map(id => oldClasses.get(id)!).filter(row => row.active && (!row.closedAt || row.closedAt >= date));
  const originalStudents = new Set(Object.values(source.initialStudents).flat());
  for (const [id, name] of Object.entries(names)) {
    const before = context.students.find(student => student.id === id);
    if (!name.trim() || name.length > 40) throw new Error('학생 이름은 1~40자로 입력해 주세요.');
    if (!before) {
      if (!/^new:[a-f0-9-]{36}$/i.test(id) || !UUID.test(id.slice(4))) throw new Error('다른 학원의 학생이거나 학생 정보를 찾지 못했습니다.');
      plan.students.push({ id, name, beforeName: null, school: draft.studentDetails?.[id]?.school ?? null, grade: draft.studentDetails?.[id]?.grade ?? null });
    } else if (originalStudents.has(id) && before.name !== name) plan.students.push({ id, name, beforeName: before.name, school: before.school, grade: before.grade });
  }
  for (const id of new Set([...source.importedClassIds, ...classIds])) {
    const items = all.filter(item => item.classId === id && item.kind !== 'block'), students = new Set([...(source.initialStudents[id] ?? []), ...items.flatMap(item => item.students)]);
    const outsideDays = new Set(context.schedules.filter(row => row.classId === id && !imported.has(row.id) && row.validFrom<=date && (!row.validTo || row.validTo>=date)).map(row => row.day));
    for (const student of students) {
      if (!context.students.some(row => row.id === student) && !plan.students.some(row => row.id === student)) throw new Error('배정할 학생을 다시 확인해 주세요.');
      const byDay = new Map<string, boolean[]>();
      for (const item of items) { const day = koDayToEnum(item.day)!; byDay.set(day, [...byDay.get(day) ?? [], item.students.includes(student)]); }
      for (const attendance of byDay.values()) if (attendance.some(Boolean) && !attendance.every(Boolean)) throw new Error('같은 반의 같은 요일에 교시별 명단이 다릅니다. 반 전체 학생 이동 또는 등원 요일로 맞춘 뒤 적용해 주세요.');
      const wantedDays = sorted([...byDay].filter(([, attendance]) => attendance.some(Boolean)).map(([day]) => day));
      const originalDays = sorted(Object.values(source.initialPlacements).filter(item=>item.classId===id && item.students.includes(student)).map(item=>koDayToEnum(item.day)!));
      const explicitlyMoved = !!draft.studentMoves?.[id]?.[student];
      if (!explicitlyMoved && same(wantedDays,originalDays)) continue;
      const rows = context.enrollments.filter(row => row.classId === id && row.studentId === student && row.start <= date && (!row.end || (row.transferred ? row.end > date : row.end >= date)) && !row.hold);
      if (rows.length > 1) throw new Error('겹치는 수강 정보가 있습니다. 원생의 수강 정보를 먼저 확인해 주세요.');
      const before = rows[0] ?? null, classDays = sorted(context.schedules.filter(row => row.classId === id && row.validFrom<=date && (!row.validTo || row.validTo>=date)).map(row => row.day));
      if (!before && originalDays.length && wantedDays.length && !explicitlyMoved) continue;
      if (wantedDays.length && context.students.find(row => row.id === student)?.status === 'withdrawn') throw new Error(`${names[student]}: 퇴원한 학생은 먼저 재원 상태를 확인해 주세요.`);
      const actualDays = before ? sorted(before.days?.length ? before.days.filter(day => classDays.includes(day)) : classDays) : [];
      // 연습본에 없는 운영 수업의 요일은 등원 요일에서 빼지 않는다.
      const nextDays = sorted([...wantedDays, ...actualDays.filter(day => outsideDays.has(day))]);
      // 다니던 수업만 지워졌으면 운영 수업의 요일로 남는다. 남은 수업에서 빠졌거나, 반이 닫히거나, 다른 반으로 갔으면 나간 것이다.
      const joined = (other: Lesson) => other.classId !== id && other.kind !== 'block' && other.students.includes(student) && !source.initialStudents![other.classId]?.includes(student);
      const left = !items.length || items.some(item => source.initialPlacements![item.sourceScheduleId ?? '']?.students.includes(student)) || all.some(joined);
      if (before && !wantedDays.length && (left || !nextDays.length)) plan.enrollments.push({ before, studentId: student, classId: id, days: [], remove: true });
      else if (nextDays.length && (!before || !same(nextDays, actualDays))) plan.enrollments.push({ before, studentId: student, classId: id, days: nextDays, remove: false });
    }
  }
  // 영어의 마지막 수업을 연습본으로 끝내지 않는다 — 수강 종료 창과 같은 규칙(원장 2026-11-02). 옮긴 학생은 새 반이 이어받아 해당 없다.
  const ending = new Set(plan.enrollments.flatMap(row => row.remove && row.before ? [row.before.id] : []));
  for (const row of plan.enrollments) {
    const student = context.students.find(entry => entry.id === row.studentId), group = oldClasses.get(row.classId);
    if (!row.remove || !student || (student.status !== 'enrolled' && student.status !== 'on_hold')) continue;
    if (group && isSpecialLecture({ isSpecial: group.special, className: group.name })) continue;
    const continues = plan.enrollments.some(other => other.studentId === row.studentId && !other.remove) || context.enrollments.some(other => other.studentId === row.studentId && !ending.has(other.id) && (!other.end || other.end > date));
    if (!continues) throw new Error(`${student.name}: ${SUBJECT_END_VIA_REPORT}`);
  }
  const touched = new Set([...plan.schedules.map(row => row.item.classId), ...plan.removedSchedules.map(row => row.classId), ...plan.enrollments.map(row => row.classId)]);
  const changedSources = new Set([...plan.schedules.flatMap(row=>row.before?[row.before.id]:[]),...plan.removedSchedules.map(row=>row.id),...plan.blocks.flatMap(row=>row.before?[`block:${row.before.id}`]:[]),...plan.removedBlocks.map(row=>`block:${row.id}`)]);
  const changedRosterClasses = new Set(plan.enrollments.map(row=>row.classId));
  for (const id of imported) {
    const before = id.startsWith('block:') ? oldBlocks.get(id.slice(6))! : oldSchedules.get(id)!;
    if (before.validTo && before.validTo < date && (changedSources.has(id) || ('classId' in before && changedRosterClasses.has(before.classId)))) throw new Error('변경할 배치가 적용일에는 이미 종료되어 있습니다. 적용할 주의 시간표를 다시 불러와 주세요.');
  }
  if (context.schedules.some(row => touched.has(row.classId) && row.validFrom > date) || context.enrollments.some(row => touched.has(row.classId) && row.start > date)) throw new Error('적용일 이후의 배치 또는 수강 예약이 있습니다. 기존 예약을 먼저 확인해 주세요.');
  plan.summary = { schedules: plan.schedules.length + plan.removedSchedules.length, blocks: plan.blocks.length + plan.removedBlocks.length, classes: plan.classes.length + plan.closedClasses.length, students: plan.students.length, enrollments: plan.enrollments.length, teacherNames: plan.people.length };
  return plan;
}
