import { enumDayToKo, koDayToEnum } from '@/features/timetable/lib/periods';
import { specialSlotLabel } from '@/features/timetable/lib/teacher-label';
import { classList } from './editor/class-commands';
import { lessons, timeLabel, timeMinutes, type Draft, type Lesson } from './editor/model';
import { teacherColumns } from './editor/teachers';
import { blockTeacher, equalNames, scheduleRoom, scheduleTeacher } from './apply-plan';
import type { ApplyContext, NativeStudent, OutsideSlot } from './server/apply-context';

type Base = NonNullable<NonNullable<Draft['source']>['initialPlacements']>[string];
type Spot = { classId: string; day: string; start: number; end: number };
/** `shownRoom` = 연습본이 불러올 때 읽는 규칙의 강의실(슬롯 라벨 → 반 강의실) — 연습본 값과 비교할 때만 쓴다. */
type Live = Spot & { key: string; slot: OutsideSlot; shownRoom: string };
export type RebasedDraft = {
  /** 최신 운영 행과 명단에 다시 맞춘 연습본 — 적용 계획은 이것으로 만든다. */ draft: Draft;
  /** 연습본에 없는 최신 운영 행을 겹침 검사에 넣은 자료. */ context: ApplyContext;
  notices: string[];
  /** 운영에서 먼저 바뀌어 적용하지 않는 변경 — 사용자가 확인해야 하고, 적용 내역에도 남는다. */ skipped: string[];
};

const classOpen = (row: ApplyContext['classes'][number], date: string) => row.active && (!row.closedAt || row.closedAt >= date);
const sameSpot = (a: Spot, b: Spot) => a.classId === b.classId && a.day === b.day && a.start === b.start && a.end === b.end;
const sameRoster = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === new Set(a).size;
const skipLabel = (what: string) => `적용 제외 · ${what}: 운영에서 먼저 바뀌어 최신 시간표를 유지합니다.`;
const lessonLabel = (name: string, at: Spot) => `${name} · ${at.day} ${timeLabel(at.start)}~${timeLabel(at.end)}`;
const untouched = (item: Lesson, base: Base) => item.classId === base.classId && item.name === base.name && item.day === base.day && item.start === base.start && item.end === base.end && item.teacher === base.teacher && item.room === base.room && !!item.labSeparate === base.labSeparate;
const classIdsOf = (list: readonly Lesson[]) => new Set(list.flatMap(item => item.kind === 'block' || !item.classId ? [] : [item.classId]));

/** 적용일에 끝나지 않은 운영 행. 끝난 반의 행은 남아 있어도 없는 것으로 본다. */
function liveRows(context: ApplyContext, date: string): Live[] {
  const classes = new Map(context.classes.map(row => [row.id, row]));
  const open = (row: { validTo: string | null }) => !row.validTo || row.validTo >= date;
  const live = (key: string, slot: OutsideSlot, shownRoom: string): Live => ({ key, slot, shownRoom, classId: slot.classId, day: enumDayToKo(slot.day as Parameters<typeof enumDayToKo>[0]), start: timeMinutes(slot.start)!, end: timeMinutes(slot.end)! });
  return [
    ...context.schedules.flatMap(row => {
      const group = classes.get(row.classId);
      if (!open(row) || !group || !classOpen(group, date)) return [];
      const teacher = scheduleTeacher(row, context), room = scheduleRoom(row, context);
      const shownRoom = row.roomLabel || context.rooms.find(entry => entry.id === group.roomId)?.name || '';
      return [live(row.id, { id: row.id, classId: row.classId, name: group.name, teacher: teacher.name, teacherId: teacher.id, room: room.name, roomId: room.id, day: row.day, start: row.start, end: row.end, validFrom: row.validFrom, validTo: row.validTo, students: [] }, shownRoom)];
    }),
    ...context.blocks.filter(open).map(row => {
      const teacher = blockTeacher(row, context);
      return live(`block:${row.id}`, { id: row.id, classId: '', name: row.label, teacher: teacher.name, teacherId: teacher.id, room: '', roomId: null, day: row.day, start: row.start, end: row.end, validFrom: row.validFrom, validTo: row.validTo, students: [] }, '');
    }),
  ];
}

/** 연습본에서 만든 새 반과 같은 이름의 반이 운영에 생겼다 — 같은 반으로 본다. 그대로 두면 이름이 겹치는 반을 또 만들게 된다. */
function adoptLiveClasses(draft: Draft, context: ApplyContext, date: string): number {
  const groups = classList(draft), inDraft = new Set(groups.map(group => group.id));
  let adopted = 0;
  for (const group of groups) {
    if (context.classes.some(row => row.id === group.id) || group.items.some(item => item.sourceScheduleId)) continue;
    const named = context.classes.filter(row => row.name === group.name && classOpen(row, date));
    if (named.length !== 1 || inDraft.has(named[0].id)) continue;
    const to = named[0].id;
    for (const placement of draft.placements) if (placement.classId === group.id) placement.classId = to;
    for (const list of [draft.students, draft.classes, draft.studentMoves]) if (list?.[group.id]) { (list as Record<string, unknown>)[to] = list[group.id]; delete list[group.id]; }
    for (const entry of draft.appearance?.groups?.groups ?? []) entry.classIds = entry.classIds.map(id => id === group.id ? to : id);
    adopted++;
  }
  return adopted;
}

/** 운영에서 바뀐 강사 이름을 따른다. 불러올 때의 이름 그대로인 칸만 바꾼다 — 연습본에서 새로 지은 이름은 강사 이름 변경이다. */
function followTeacherNames(draft: Draft, context: ApplyContext, initial: Record<string, Base>, live: ReadonlyMap<string, Live>) {
  const loaded = new Set(Object.values(initial).map(row => row.teacher)), renamed = new Map<string, string>();
  const known = (name: string) => context.people.some(person => [person.name, person.englishName ?? ''].some(value => value && equalNames(value, name)));
  for (const placement of draft.placements) {
    const person = context.people.find(row => row.id === placement.teacherId), name = draft.cells[placement.row]?.[4]?.text;
    if (person && name && loaded.has(name) && !known(name)) renamed.set(name, person.name);
  }
  // 연습본이 그 강사의 수업을 모두 넘겼어도 불러온 행으로 알 수 있다.
  for (const [id, base] of Object.entries(initial)) {
    const row = live.get(id);
    if (row?.slot.teacherId && !known(base.teacher) && !specialSlotLabel(base.teacher)) renamed.set(base.teacher, row.slot.teacher);
  }
  const follow = (name: string) => renamed.get(name) ?? name;
  for (const placement of draft.placements) {
    const cell = draft.cells[placement.row]?.[4];
    if (cell) cell.text = follow(cell.text);
  }
  for (const row of Object.values(initial)) row.teacher = follow(row.teacher);
  const source = draft.source!;
  // 담임 칸도 함께 옮긴다 — 옛 이름이 남으면 등록되지 않은 강사로 거절된다.
  for (const info of [...Object.values(draft.classes ?? {}), ...Object.values(source.initialClasses ?? {})]) if (info.homeroomTeacher) info.homeroomTeacher = follow(info.homeroomTeacher);
  // 순서 설정도 같은 이름으로 옮긴다 — 안 그러면 '강사 순서 변경'으로 읽힌다.
  if (draft.teachers) draft.teachers = draft.teachers.map(follow);
  if (source.initialTeacherOrder) source.initialTeacherOrder = source.initialTeacherOrder.map(follow);
}

/** 앞선 적용으로 등록된 새 학생은 실제 식별자로 잇고, 운영에서 지워진 학생은 뺀다. */
function tidyStudents(draft: Draft, initial: Record<string, Base>, students: ReadonlyMap<string, NativeStudent>) {
  const resolved = (id: string) => id.startsWith('new:') && students.has(id.slice(4)) ? id.slice(4) : id;
  const known = (id: string) => id.startsWith('new:') || students.has(id);
  const tidy = (list: readonly string[]) => list.map(resolved).filter(known);
  for (const placement of draft.placements) if (placement.studentIds) placement.studentIds = tidy(placement.studentIds);
  for (const list of [draft.students, draft.source!.initialStudents!]) for (const id of Object.keys(list)) list[id] = tidy(list[id]);
  for (const row of Object.values(initial)) row.students = tidy(row.students);
  if (draft.people) draft.people = Object.fromEntries(Object.entries(draft.people).map(([id, name]) => [resolved(id), name] as const).filter(([id]) => known(id)));
}

function membership(rows: readonly { classId: string; students: readonly string[] }[]) {
  const map = new Map<string, Set<string>>();
  for (const row of rows) if (row.classId) map.set(row.classId, new Set([...map.get(row.classId) ?? [], ...row.students]));
  return map;
}

/**
 * 불러온 뒤 운영 시간표가 바뀌어도 적용을 막지 않는다 — 최신 운영 자료 위에 연습본에서 바꾼 것만 다시 얹는다(원장 2026-11-02).
 * 운영에서 생긴 변경은 지우지 않고, 양쪽이 같은 것을 다르게 바꿨으면 최신 시간표를 남기고 `skipped`로 알린다.
 * 🔴 수업이 빠지면 그 반에 걸린 학생 이동도 통째로 뺀다 — 양쪽 반 중 한쪽만 적용되면 수강이 끊기거나 두 반에 겹친다.
 * 운영이 그대로면(`operatingChanged`=false) 끝난 행 정리와 앞선 적용 찾기만 한다 — 이름·명단은 연습본 그대로다.
 */
export function rebaseDraft(input: Draft, context: ApplyContext, date: string, operatingChanged: boolean): RebasedDraft {
  if (!input.source?.importedIds || !input.source.importedClassIds || !input.source.initialStudents || !input.source.initialPlacements || !input.source.initialClasses) return { draft: input, context, notices: [], skipped: [] }; // buildApplyPlan이 거절한다
  const draft = structuredClone(input), source = draft.source!, initial = source.initialPlacements!, initialClasses = source.initialClasses!;
  const classes = new Map(context.classes.map(row => [row.id, row])), students = new Map(context.students.map(row => [row.id, row]));
  const skipped: string[] = [], metadata = (source.initialSlotMetadata ??= {});
  const live = new Map(liveRows(context, date).map(row => [row.key, row]));
  draft.teachers = teacherColumns(input); // 빠지는 수업 때문에 '강사 순서 변경'으로 보이지 않게 한다
  const adopted = operatingChanged ? adoptLiveClasses(draft, context, date) : 0;
  if (operatingChanged) { followTeacherNames(draft, context, initial, live); tidyStudents(draft, initial, students); }
  const original = lessons(draft).items, loaded = Object.values(initial);
  const person = (name: string) => context.people.find(row => [row.name, row.englishName ?? ''].some(value => value && equalNames(value, name)));
  const sameTeacher = (a: string, b: string) => equalNames(a, b) || (!!person(a) && person(a) === person(b));

  const imported = new Set(source.importedIds);
  const free = [...live.values()].filter(row => !imported.has(row.key));
  const take = (test: (row: Live) => boolean) => { const index = free.findIndex(test); return index < 0 ? null : free.splice(index, 1)[0]; };
  const placed = (row: Live, at: Spot & { teacher: string }) => sameSpot(row, at) && sameTeacher(row.slot.teacher, at.teacher);
  // 적용일 뒤에 시작하는 수업은 그때까지 없는 수업이다(`buildApplyPlan`이 예약으로 거절한다). 일정은 그 검사가 없어 다시 적용할 때 찾아 준다.
  const effective = (row: Live, item?: Lesson) => row.slot.validFrom <= date || (operatingChanged && item?.kind === 'block');
  const items = new Map(original.flatMap(item => item.sourceScheduleId ? [[item.sourceScheduleId, item] as const] : []));
  const placementOf = (item: Lesson) => draft.placements.find(entry => entry.id === item.id);
  const link = (id: string | null, item: Lesson | undefined, row: Live, base: Base) => {
    if (id) { imported.delete(id); delete initial[id]; }
    imported.add(row.key); initial[row.key] = base;
    const note = id ? metadata[id] : item && { note: item.note ?? '', locked: !!item.locked };
    if (id) delete metadata[id];
    if (note) metadata[row.key] = note;
    const placement = item && placementOf(item);
    if (placement) placement.sourceScheduleId = row.key;
  };
  const dropped = new Set<string>(), lateIds = new Set<string>();
  const drop = (item: Lesson) => {
    draft.placements = draft.placements.filter(entry => entry.id !== item.id);
    if (item.classId) dropped.add(item.classId);
  };

  const broken = new Set([...imported].filter(id => !live.has(id)));
  // ① 연습본의 결과가 이미 운영에 있다 — 그 행을 원본으로 삼는다. 같은 저장본을 다시 적용해도 수업이 두 번 들어가지 않는다.
  for (const id of broken) {
    const item = items.get(id), base = initial[id], row = item ? take(row => effective(row, item) && placed(row, item)) : null;
    if (!item || !row) continue;
    link(id, item, row, !base ? { ...item, labSeparate: !!item.labSeparate, students: [] } : untouched(item, base) ? base : { ...base, classId: item.classId, name: item.name, day: item.day, start: item.start, end: item.end, teacher: item.teacher });
    broken.delete(id);
  }
  const appliedBefore = new Set(context.appliedNewIds ?? []);
  for (const item of original) {
    if (item.sourceScheduleId) continue;
    const row = take(row => effective(row, item) && placed(row, item));
    if (row) { lateIds.add(row.key); link(null, item, row, { name: item.name, classId: item.classId, day: item.day, start: item.start, end: item.end, teacher: item.teacher, room: item.room, labSeparate: !!item.labSeparate, students: [] }); continue; } // 이미 있는 수업은 손대지 않는다
    if (!operatingChanged) continue;
    const group = classes.get(item.classId), closed = source.importedClassIds!.includes(item.classId) && !(group && classOpen(group, date));
    const taken = item.kind === 'lesson' && free.some(row => effective(row) && sameSpot(row, item) && !specialSlotLabel(row.slot.teacher));
    // 앞서 적용한 새 수업이 운영에서 옮겨지거나 없어졌으면 다시 넣지 않는다.
    if (closed || taken || appliedBefore.has(item.id)) { drop(item); skipped.push(skipLabel(lessonLabel(item.name, item))); }
  }
  // ② 행 식별자만 바뀌었다(시트 가져오기는 행을 새로 만든다) — 연습본 변경을 그 행에 얹는다. 반 이름까지 바뀌었으면 다른 수업으로 본다.
  for (const id of broken) {
    const base = initial[id], item = items.get(id), row = base && (!base.classId || classes.get(base.classId)?.name === base.name) ? take(row => effective(row, item) && placed(row, base)) : null;
    if (!row) continue;
    link(id, item, row, base);
    broken.delete(id);
  }
  // ③ 운영에서 없어졌거나 먼저 바뀌었다 — 최신 시간표를 남긴다.
  let gone = 0;
  for (const id of broken) {
    const item = items.get(id), base = initial[id];
    imported.delete(id); delete initial[id];
    if (item) {
      drop(item);
      if (base && untouched(item, base) && sameRoster(item.students, base.students)) gone++; else skipped.push(skipLabel(lessonLabel(item.name, item)));
    } else if (base && free.some(row => row.classId === base.classId && sameTeacher(row.slot.teacher, base.teacher))) skipped.push(skipLabel(`${lessonLabel(base.name, base)} 삭제`));
  }
  // 강사·강의실을 양쪽이 다르게 바꿨다(강사 인수인계는 행을 그 자리에서 고친다). 다시 연결한 행도 같은 기준으로 본다.
  if (operatingChanged) for (const item of original) {
    const id = placementOf(item)?.sourceScheduleId, row = id ? live.get(id) : undefined, base = id ? initial[id] : undefined, cells = draft.cells[item.row];
    if (!row || !base || !cells) continue;
    if (item.teacher !== base.teacher && !sameTeacher(row.slot.teacher, base.teacher) && !sameTeacher(row.slot.teacher, item.teacher)) {
      const info = draft.classes?.[item.classId];
      if (info?.homeroomTeacher === item.teacher) info.homeroomTeacher = row.slot.teacher;
      cells[4] = { ...cells[4], text: row.slot.teacher }; base.teacher = row.slot.teacher;
      skipped.push(skipLabel(`${lessonLabel(item.name, item)} 강사`));
    }
    if (item.room !== base.room && row.shownRoom !== base.room && row.shownRoom !== item.room) {
      cells[5] = { ...cells[5], text: row.shownRoom }; base.room = row.shownRoom;
      skipped.push(skipLabel(`${lessonLabel(item.name, item)} 강의실`));
    }
  }

  // 수강은 적용일의 최신 명단을 기준으로 삼는다.
  const enrolled = (classId: string) => context.enrollments.filter(row => row.classId === classId && !row.hold && students.get(row.studentId)?.status !== 'withdrawn' && row.start <= date && (!row.end || (row.transferred ? row.end > date : row.end >= date)));
  const rosterAt = (classId: string, day: string | null) => enrolled(classId).filter(row => !row.days?.length || (!!day && row.days.includes(day))).map(row => row.studentId);
  // 연습본이 닫는 반에 운영이 넣은 수업·학생이 있으면 닫지 않는다 — 수업만 지우면 남은 학생이 갈 곳을 잃는다.
  const had = classIdsOf(original), importedClasses = source.importedClassIds!;
  const closing = new Set(importedClasses.filter(id => !had.has(id) && classes.has(id) && classOpen(classes.get(id)!, date)));
  const keepClasses = new Set([...closing].filter(id => operatingChanged && (free.some(row => row.classId === id) || enrolled(id).some(row => !source.initialStudents![id]?.includes(row.studentId)))));
  // 학생 이동은 나가는 반과 들어가는 반이 한 건이다 — 어느 쪽 수업이 빠졌거나, 나가는 반이 남거나, 운영이 먼저 다른 곳으로 옮겼으면 통째로 뺀다.
  // 한 명이 빠지면 그 반이 남아 다른 학생도 빠질 수 있어 더 빠질 것이 없을 때까지 돈다.
  const before = membership(loaded), after = membership(original.filter(item => item.kind !== 'block'));
  const movedClasses = [...new Set([...before.keys(), ...after.keys()])];
  const movers = [...new Set([...before.values(), ...after.values()].flatMap(set => [...set]))].map(student => ({ student,
    leaving: movedClasses.filter(id => before.get(id)?.has(student) && !after.get(id)?.has(student)),
    joining: movedClasses.filter(id => !before.get(id)?.has(student) && after.get(id)?.has(student)) })).filter(row => row.leaving.length || row.joining.length);
  const cancelled = new Set<string>();
  for (let settled = false; !settled;) {
    settled = true;
    for (const { student, leaving, joining } of movers) {
      if (cancelled.has(student)) continue;
      const attends = (id: string) => enrolled(id).some(row => row.studentId === student);
      const halfMove = [...leaving, ...joining].some(id => dropped.has(id)) || leaving.some(id => keepClasses.has(id));
      const movedElsewhere = operatingChanged && leaving.length > 0 && joining.length > 0 && leaving.some(id => !attends(id)) && joining.some(id => !attends(id));
      // 운영이 등원 요일을 바꿔 불러온 수업 명단에서 빠졌다 — 나가는 반의 수강을 끝낼 수 없어 새 반만 생기면 두 반에 겹친다.
      const offRoster = operatingChanged && leaving.some(id => attends(id) && !Object.values(initial).some(row => row.classId === id && rosterAt(id, koDayToEnum(row.day)).includes(student)));
      if (!halfMove && !movedElsewhere && !offRoster) continue;
      cancelled.add(student); settled = false;
      for (const id of leaving) if (closing.has(id)) keepClasses.add(id);
    }
    // 학생이 모두 빠진 새 반은 만들지 않는다.
    for (const [id, members] of after) {
      const orphan = !classes.has(id) && members.size > 0 && [...members].every(student => cancelled.has(student));
      const left = orphan ? original.filter(item => item.classId === id && placementOf(item)) : [];
      if (!left.length) continue;
      for (const item of left) drop(item);
      skipped.push(skipLabel(`새 반 · ${left[0].name}`)); settled = false;
    }
  }
  for (const student of cancelled) {
    skipped.push(skipLabel(`학생 이동 · ${draft.people?.[student] ?? '학생'}`));
    if (student.startsWith('new:') && draft.people) delete draft.people[student];
    for (const moves of Object.values(draft.studentMoves ?? {})) delete moves[student];
  }
  // 연습본이 지운 수업에 남아야 할 학생의 마지막 수업이면 되돌린다 — 지우면 수강은 있는데 시간표·출결에는 나오지 않는다.
  // 이동이 취소된 학생, 운영이 그 수업으로 옮긴 학생, 운영이 나머지 수업을 없앤 반의 학생이다.
  const leaversOf = (classId: string) => movers.filter(row => row.leaving.includes(classId) && !cancelled.has(row.student)).map(row => row.student);
  if (operatingChanged) for (const [id, base] of Object.entries(initial)) {
    const row = live.get(id);
    if (!row || !base.classId || keepClasses.has(base.classId) || draft.placements.some(entry => entry.sourceScheduleId === id)) continue;
    const others = lessons(draft).items.filter(item => item.classId === base.classId && item.kind !== 'block'), leavers = leaversOf(base.classId);
    const attends = (student: string) => others.some(item => rosterAt(base.classId, koDayToEnum(item.day)).includes(student));
    if (!rosterAt(base.classId, koDayToEnum(base.day)).some(student => !leavers.includes(student) && !attends(student) && (cancelled.has(student) || !base.students.includes(student) || dropped.has(base.classId)))) continue;
    draft.placements.push({ ...metadata[id], id, sourceScheduleId: id, classId: base.classId, row: draft.cells.length, teacherId: row.slot.teacherId, roomId: row.slot.roomId, kind: specialSlotLabel(base.teacher) ? 'seat' : 'lesson', studentIds: base.students, labSeparate: base.labSeparate });
    draft.cells.push([base.name, base.day, timeLabel(base.start), timeLabel(base.end), base.teacher, base.room].map(text => ({ text })));
    skipped.push(skipLabel(`${lessonLabel(base.name, base)} 삭제`));
  }

  // 수업이 전부 빠진 반을 '반 종료'로 읽지 않게 불러온 범위에서 뺀다. 앞선 적용으로 이미 운영에 있는 새 반은 범위에 넣는다.
  const current = lessons(draft).items, kept = classIdsOf(current);
  for (const id of keepClasses) skipped.push(skipLabel(`반 종료 · ${classes.get(id)!.name}`));
  source.importedClassIds = [...new Set([...importedClasses, ...kept])].filter(id => classes.has(id) && !keepClasses.has(id) && (kept.has(id) || !had.has(id)));
  for (const id of source.importedClassIds) {
    const row = classes.get(id)!, name = current.find(item => item.classId === id)?.name, base = initialClasses[id];
    if (!base) { initialClasses[id] = { ...draft.classes?.[id], name: name ?? row.name }; continue; }
    if (base.name === row.name) continue;
    if (name) (draft.classes ??= {})[id] = { ...draft.classes?.[id], name: name === base.name ? row.name : name };
    if (name && name !== base.name && name !== row.name) { draft.classes![id].name = row.name; skipped.push(skipLabel(`반 이름 · ${name}`)); }
    base.name = row.name;
    for (const placement of Object.values(initial)) if (placement.classId === id) placement.name = row.name;
  }
  // 남기기로 한 반의 수업은 지우지 않는다.
  const finalIds = new Set(current.flatMap(item => placementOf(item)?.sourceScheduleId ?? []));
  for (const id of [...imported]) if (!finalIds.has(id) && keepClasses.has(initial[id]?.classId)) { imported.delete(id); delete initial[id]; }
  source.importedIds = [...imported];

  // 명단: 최신 명단 위에 연습본에서 넣고 뺀 학생만 얹는다.
  const bySource = new Map(current.flatMap(item => { const id = placementOf(item)?.sourceScheduleId; return id ? [[id, item] as const] : []; }));
  for (const [id, base] of Object.entries(initial)) {
    if (id.startsWith('block:')) continue;
    const item = bySource.get(id), placement = item && placementOf(item);
    const latest = operatingChanged ? rosterAt(base.classId, koDayToEnum(base.day)) : base.students;
    // 반을 나가는 학생은 수업마다가 아니라 반 단위로 뺀다 — 운영이 요일을 바꿨으면 불러온 명단에 없던 수업에 들어 있다.
    const leavers = leaversOf(base.classId);
    if (item && placement && !lateIds.has(id)) {
      const added = item.students.filter(student => !base.students.includes(student) && !cancelled.has(student));
      const removed = new Set([...base.students, ...leavers].filter(student => !item.students.includes(student) && !cancelled.has(student)));
      placement.studentIds = [...new Set([...latest.filter(student => !removed.has(student)), ...added])];
    }
    // 지운 수업에는 연습본이 모르는 학생을 넣지 않는다 — 넣으면 그 학생의 수강이 끝난다. 나가는 학생은 넣어야 수강이 끝난다.
    base.students = item ? latest : latest.filter(student => base.students.includes(student) || leavers.includes(student));
  }
  // 새 수업은 불러올 때의 반 명단을 복사한 것이다 — 그 사이 나간 학생은 빼고 새로 온 학생은 넣는다. 같은 날 다른 수업이 있으면 그 명단을 따른다.
  const isNew = (item: Lesson) => { const id = placementOf(item)?.sourceScheduleId; return !id || lateIds.has(id); };
  for (const item of current) {
    const placement = placementOf(item);
    if (!placement || item.kind === 'block' || !isNew(item)) continue;
    const own = item.students.filter(student => !cancelled.has(student));
    if (!operatingChanged) { placement.studentIds = own; continue; }
    const sibling = current.find(other => other.classId === item.classId && other.day === item.day && other.kind !== 'block' && !isNew(other));
    const wasIn = before.get(item.classId) ?? new Set<string>(), still = new Set(enrolled(item.classId).map(row => row.studentId));
    const removed = new Set([...wasIn].filter(student => !item.students.includes(student)));
    placement.studentIds = sibling ? placementOf(sibling)?.studentIds ?? own
      : [...new Set([...own.filter(student => !wasIn.has(student) || still.has(student)), ...rosterAt(item.classId, koDayToEnum(item.day)).filter(student => !removed.has(student) && !cancelled.has(student))])];
  }
  // 같은 반의 같은 요일은 명단이 하나다. 연습본에서 같았던 명단이 요일별 최신 명단으로 갈라지면 합친다 — 한쪽을 따르면 빠진 학생의 수강이 끝난다.
  // 연습본부터 달랐으면 그대로 두어 `buildApplyPlan`이 거절한다.
  if (operatingChanged) for (const item of current) {
    const sameDay = current.filter(other => other.kind !== 'block' && other.classId === item.classId && other.day === item.day);
    if (item.kind === 'block' || sameDay.length < 2 || !sameDay.every(other => sameRoster(other.students, item.students))) continue;
    const roster = [...new Set(sameDay.flatMap(other => placementOf(other)!.studentIds ?? []))];
    for (const other of sameDay) placementOf(other)!.studentIds = roster;
  }
  const rebased = lessons(draft).items;
  for (const id of Object.keys(draft.students)) draft.students[id] = [...new Set(rebased.filter(item => item.classId === id).flatMap(item => item.students))];
  source.initialStudents = Object.fromEntries(source.importedClassIds.map(id => [id, [...new Set(Object.values(initial).filter(row => row.classId === id).flatMap(row => row.students))]]));

  // 저장본에는 불러올 때의 학생 이름이 없다 — 운영이 바뀐 뒤에는 운영 이름을 믿는다.
  let names = 0;
  if (operatingChanged && draft.people) {
    for (const [id, name] of Object.entries(draft.people)) {
      const row = students.get(id);
      if (row && row.name !== name) { draft.people[id] = row.name; names++; }
    }
    for (const item of rebased) for (const student of item.students) draft.people[student] ??= students.get(student)?.name ?? '학생';
  }
  if (names) skipped.push(skipLabel(`학생 이름 ${names}건`));

  // 겹침은 적용 뒤의 모습으로 검사한다 — 연습본에 없는 운영 행을 함께 본다.
  const outside = free.filter(row => row.slot.validFrom <= date).map(row => ({ ...row.slot, students: row.classId ? rosterAt(row.classId, row.slot.day) : [] }));
  const notices = [
    ...(operatingChanged ? ['연습본을 불러온 뒤 운영 시간표가 바뀌어 최신 시간표 기준으로 검사했습니다. 연습본에서 바꾼 내용만 적용됩니다.'] : []),
    ...(adopted ? [`연습본에서 만든 새 반 ${adopted}개는 같은 이름의 운영 반으로 합쳤습니다.`] : []),
    ...(gone ? [`운영에서 없어지거나 끝난 수업·일정 ${gone}건은 적용 대상에서 뺐습니다.`] : []),
    ...(outside.length ? [`연습본에 없는 운영 수업·일정 ${outside.length}건은 그대로 두고 겹침 검사에 넣었습니다.`] : []),
  ];
  return { draft, context: { ...context, outside: [...context.outside ?? [], ...outside] }, notices, skipped };
}
