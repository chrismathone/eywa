import { assertUnlocked, copyBlocks, moveBlocks } from './block-commands';
import { changed, checkClassName, classList } from './class-commands';
import { days, lessons, timeLabel, type Draft, type Lesson, type Placement } from './model';
import { checkOperatingTime, isAllowedTime } from './operating-times';
import { keepColumns, teacherColumns } from './teachers';
import type { LabColor } from '@/features/timetable-lab/types';

/** 새 항목이 놓일 자리. 강의실은 비워 둘 수 있다(미정). */
export type Slot = { day: string; teacher: string; start: number; end: number; room?: string; labSeparate?: boolean };
const text = (value: string) => ({ text: value });
const plain = (draft: Draft, row: number, col: number, value: string) => ({ ...draft.cells[row][col], text: value, formula: undefined, richText: undefined });

function checkSlot(draft: Draft, items: Lesson[], at: Slot, kind: 'lesson' | 'block') {
  if (!days.includes(at.day) || !teacherColumns(draft, items).includes(at.teacher)) throw new Error('요일과 강사를 선택해 주세요.');
  if (kind === 'block') {
    if (!isAllowedTime(draft, 'block', at.day, at.start, at.end)) throw new Error('하루 안에서 시작보다 늦은 종료 시간을 골라 주세요.');
    if (['LAB', 'JJ'].includes(at.teacher) || items.some(p => p.teacher === at.teacher && p.kind === 'seat')) throw new Error('비수업 일정은 강사 열에 놓아 주세요.');
  } else checkOperatingTime(draft, at.day, at.start, at.end);
  if ((at.room ?? '').length > 40) throw new Error('강의실 이름은 40자까지 쓸 수 있습니다.');
}
/** 표에 한 줄을 더하고 그 줄을 가리키는 배치를 만든다. */
function place(next: Draft, name: string, at: Slot, placement: Omit<Placement, 'id' | 'row' | 'sourceScheduleId'>) {
  const row = next.cells.length, id = crypto.randomUUID();
  next.cells.push([name, at.day, timeLabel(at.start), timeLabel(at.end), at.teacher, at.room ?? ''].map(text));
  next.placements.push({ ...placement, id, row, sourceScheduleId: null });
  return id;
}
const seatKind = (items: Lesson[], teacher: string) => ['LAB', 'JJ'].includes(teacher) || items.some(p => p.teacher === teacher && p.kind === 'seat') ? 'seat' as const : 'lesson' as const;
const teacherIdOf = (items: Lesson[], teacher: string) => items.find(p => p.teacher === teacher && p.teacherId)?.teacherId ?? null;
const roomIdOf = (items: Lesson[], room?: string) => (room && items.find(p => p.room === room && p.roomId)?.roomId) || null;

/** 이미 있는 반에 수업을 하나 더한다. 그 반 학생 전원이 이 수업에도 배정된다. */
export function addLesson(draft: Draft, classId: string, at: Slot): Draft {
  const items = lessons(draft).items, group = classList(draft).find(c => c.id === classId);
  if (!group) throw new Error('수업을 더할 반을 선택해 주세요.');
  checkSlot(draft, items, at, 'lesson');
  const next = structuredClone(draft);
  place(next, group.name, at, { classId, teacherId: teacherIdOf(items, at.teacher), roomId: roomIdOf(items, at.room),
    kind: seatKind(items, at.teacher), studentIds: [...group.students], labSeparate: at.teacher === 'LAB' && !!at.labSeparate });
  return next;
}
/** 새 반을 만들고 첫 수업을 놓는다. 학생은 비어 있다 — 통합뷰에서 끌어 넣거나 ‘학생 넣기’로 채운다. */
export function addClass(draft: Draft, name: string, at: Slot, options: { color?: LabColor; homeroomTeacher?: string } = {}): Draft {
  const items = lessons(draft).items, value = checkClassName(draft, name);
  checkSlot(draft, items, at, 'lesson');
  const next = changed(draft), classId = crypto.randomUUID();
  place(next, value, at, { classId, teacherId: teacherIdOf(items, at.teacher), roomId: roomIdOf(items, at.room), kind: seatKind(items, at.teacher), studentIds: [], labSeparate: at.teacher === 'LAB' && !!at.labSeparate });
  next.students[classId] = [];
  (next.classes ??= {})[classId] = { name: value, color: options.color, homeroomTeacher: options.homeroomTeacher ?? at.teacher };
  // 통합뷰가 묶음에 든 반만 보여 주는 설정이면 마지막 묶음에 넣어 바로 보이게 한다.
  const groups = next.appearance?.groups;
  if (groups && !groups.showOthers) groups.groups.at(-1)?.classIds.push(classId);
  return next;
}
/** 회의·상담 같은 비수업 일정. 수업 운영시간에 묶이지 않는다. */
export function addBlock(draft: Draft, label: string, at: Slot): Draft {
  const items = lessons(draft).items, value = label.trim();
  if (!value || value.length > 80) throw new Error('일정 이름은 1~80자로 입력해 주세요.');
  checkSlot(draft, items, at, 'block');
  const next = structuredClone(draft);
  place(next, value, { ...at, room: '' }, { classId: '', teacherId: teacherIdOf(items, at.teacher), roomId: null, kind: 'block' });
  return next;
}
export function renameBlock(draft: Draft, id: string, label: string): Draft {
  const item = lessons(draft).items.find(p => p.id === id), value = label.trim();
  if (!item || item.kind !== 'block') throw new Error('이름을 바꿀 일정을 다시 선택해 주세요.');
  if (!value || value.length > 80) throw new Error('일정 이름은 1~80자로 입력해 주세요.');
  if (value === item.name) return draft;
  const next = structuredClone(draft);
  next.cells[item.row][0] = plain(draft, item.row, 0, value);
  return next;
}
/** 반과 그 반의 수업을 연습본에서 모두 없앤다. 학생은 다른 반 배정을 그대로 가진다. */
export function deleteClass(draft: Draft, classId: string): Draft {
  const group = classList(draft).find(c => c.id === classId);
  if (!group) throw new Error('지울 반을 다시 선택해 주세요.');
  assertUnlocked(group.items);
  const next = changed(draft);
  next.placements = next.placements.filter(p => p.classId !== classId);
  delete next.students[classId];
  if (next.classes) delete next.classes[classId];
  if (next.studentMoves) delete next.studentMoves[classId];
  for (const g of next.appearance?.groups?.groups ?? []) g.classIds = g.classIds.filter(id => id !== classId);
  return keepColumns(draft, next);
}
export function setHomeroom(draft: Draft, classId: string, teacher: string): Draft {
  if (!classList(draft).some(c => c.id === classId)) throw new Error('담임을 바꿀 반을 다시 선택해 주세요.');
  if (teacher && !teacherColumns(draft).includes(teacher)) throw new Error('담임으로 둘 강사를 선택해 주세요.');
  if ((draft.classes?.[classId]?.homeroomTeacher ?? '') === teacher) return draft;
  const next = structuredClone(draft);
  (next.classes ??= {})[classId] = { ...next.classes?.[classId], homeroomTeacher: teacher || undefined };
  return next;
}
/** 고른 수업들의 강의실을 한꺼번에 바꾼다. 빈 값은 ‘미정’. */
export function setRoom(draft: Draft, ids: string[], room: string): Draft {
  const all = lessons(draft).items, items = all.filter(p => ids.includes(p.id) && p.kind !== 'block'), value = room.trim();
  if (!items.length) throw new Error('강의실을 바꿀 수업을 선택해 주세요.');
  if (value.length > 40) throw new Error('강의실 이름은 40자까지 쓸 수 있습니다.');
  assertUnlocked(items);
  if (items.every(p => p.room === value)) return draft;
  const next = structuredClone(draft), roomId = roomIdOf(all, value), chosen = new Set(items.map(p => p.id));
  for (const p of items) next.cells[p.row][5] = plain(draft, p.row, 5, value);
  next.placements = next.placements.map(p => chosen.has(p.id) ? { ...p, roomId } : p);
  return next;
}
/** 연습본 전체에서 강의실 이름을 찾아 바꾼다. */
export function replaceRoom(draft: Draft, from: string, to: string): Draft {
  const ids = lessons(draft).items.filter(p => p.room === from && p.kind !== 'block').map(p => p.id);
  if (!ids.length) throw new Error(`${from || '미정'} 강의실을 쓰는 수업이 없습니다.`);
  return setRoom(draft, ids, to);
}
/** 고른 수업을 다른 요일에도 같은 시간·강사·학생으로 놓는다. 이미 그 요일인 수업은 건너뛴다. */
export function duplicateToDays(draft: Draft, ids: string[], targets: string[]): Draft {
  const items = lessons(draft).items.filter(p => ids.includes(p.id));
  if (!items.length || !targets.length || targets.some(d => !days.includes(d))) throw new Error('복사할 수업과 요일을 선택해 주세요.');
  let next = draft, made = 0;
  for (const item of items) for (const day of targets) {
    if (day === item.day) continue;
    next = copyBlocks(next, [item], item.id, { day, teacher: item.teacher, start: item.start });
    made++;
  }
  if (!made) throw new Error('이미 그 요일에 있는 수업입니다. 다른 요일을 선택해 주세요.');
  return next;
}
/** 고른 수업을 바로 아래(끝나는 시각)에 하나 더 놓는다. */
export function duplicateBelow(draft: Draft, ids: string[]): Draft {
  const items = lessons(draft).items.filter(p => ids.includes(p.id)), anchor = items[0];
  if (!anchor) throw new Error('복제할 수업을 선택해 주세요.');
  return copyBlocks(draft, items, anchor.id, { day: anchor.day, teacher: anchor.teacher, start: anchor.end });
}
/** 고른 수업을 모두 같은 분만큼 앞뒤로 민다. */
export function shiftBlocks(draft: Draft, ids: string[], minutes: number): Draft {
  const anchor = lessons(draft).items.find(p => ids.includes(p.id));
  if (!anchor || !Number.isInteger(minutes) || !minutes) throw new Error('옮길 수업을 선택해 주세요.');
  // moveBlocks는 기준 수업과 같은 강사의 수업만 강사를 바꾼다. 같은 강사를 넘기므로 아무도 강사가 바뀌지 않는다.
  return moveBlocks(draft, ids, anchor.id, { day: anchor.day, teacher: anchor.teacher, start: anchor.start + minutes });
}
/** 두 수업의 자리(요일·시작·강사)를 맞바꾼다. 길이·강의실·학생은 각자 그대로 가져간다. */
export function swapBlocks(draft: Draft, firstId: string, secondId: string): Draft {
  const items = lessons(draft).items, a = items.find(p => p.id === firstId), b = items.find(p => p.id === secondId);
  if (!a || !b || a.id === b.id) throw new Error('맞바꿀 수업 두 개를 선택해 주세요.');
  const moved = moveBlocks(draft, [a.id], a.id, { day: b.day, teacher: b.teacher, start: b.start });
  return moveBlocks(moved, [b.id], b.id, { day: a.day, teacher: a.teacher, start: a.start });
}
export function setLocked(draft: Draft, ids: string[], locked: boolean): Draft {
  if (!draft.placements.some(p => ids.includes(p.id) && !!p.locked !== locked)) return draft;
  const next = structuredClone(draft);
  next.placements = next.placements.map(p => ids.includes(p.id) ? { ...p, locked: locked || undefined } : p);
  return next;
}
export function setNote(draft: Draft, id: string, note: string): Draft {
  const value = note.trim();
  if (value.length > 300) throw new Error('메모는 300자까지 쓸 수 있습니다.');
  if (!draft.placements.some(p => p.id === id)) throw new Error('메모를 남길 수업을 다시 선택해 주세요.');
  const next = structuredClone(draft);
  next.placements = next.placements.map(p => p.id === id ? { ...p, note: value || undefined } : p);
  return next;
}
