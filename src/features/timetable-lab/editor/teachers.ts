import { buildTeacherComparator } from '@/features/timetable/lib/english-teacher-sheet';
import { lessons, type Draft, type Lesson } from './model';

const clean = (name: string) => {
  const value = name.trim();
  if (!value || value.length > 40) throw new Error('강사 이름은 1~40자로 입력해 주세요.');
  return value;
};
const cell = (draft: Draft, row: number, text: string) => ({ ...draft.cells[row][4], text, formula: undefined, richText: undefined });

/** 강사 열과 그 순서. 연습본에 굳힌 순서가 먼저 오고, 그 밖의 강사는 운영 화면과 같은 순서로 뒤에 붙는다. */
export function teacherColumns(draft: Draft, items: Lesson[] = lessons(draft).items): string[] {
  const fixed = draft.teachers ?? [];
  const rest = [...new Set(items.map(p => p.teacher))].filter(t => !fixed.includes(t)).sort(buildTeacherComparator(draft.source?.teacherOrder));
  return [...fixed, ...rest];
}
/**
 * 수업이 모두 떠난 강사 열이 **저절로 사라지지 않게** 한다 — 열이 줄어들 때만 지금 순서를 굳힌다.
 * 열을 없애는 길은 ‘이 열 지우기’ 하나뿐이다. `next`는 호출한 명령이 방금 만든 새 연습본이어야 한다.
 */
export function keepColumns(before: Draft, next: Draft): Draft {
  const columns = teacherColumns(before), after = new Set(teacherColumns(next));
  if (!columns.every(t => after.has(t))) next.teachers = columns;
  return next;
}
/** 자습·LAB처럼 자리만 잡는 열인가 — 이런 열은 강사처럼 넘기거나 맞바꿀 수 없다. */
const isSeatColumn = (items: Lesson[], teacher: string) => items.some(p => p.teacher === teacher && p.kind === 'seat');
function prepared(draft: Draft) {
  const items = lessons(draft).items, next = structuredClone(draft);
  next.teachers = teacherColumns(draft, items);
  return { items, next, columns: next.teachers };
}
function requireColumn(columns: string[], name: string) {
  if (!columns.includes(name)) throw new Error('강사를 다시 선택해 주세요.');
}

export function addTeacher(draft: Draft, name: string): Draft {
  const { next, columns } = prepared(draft), value = clean(name);
  if (columns.includes(value)) throw new Error('같은 이름의 강사 열이 이미 있습니다.');
  columns.push(value);
  return next;
}
/** 이름만 바꾼다. 수업·색·별명·담임 표시가 모두 따라간다. */
export function renameTeacher(draft: Draft, from: string, to: string): Draft {
  const { items, next, columns } = prepared(draft), value = clean(to);
  requireColumn(columns, from);
  if (value === from) return draft;
  if (columns.includes(value)) throw new Error('같은 이름의 강사 열이 이미 있습니다. 수업을 넘기려면 ‘수업 모두 넘기기’를 써 주세요.');
  // 자리 열은 이름으로 알아본다(LAB 구분 표시·색) — 이름을 바꾸면 그 표시가 풀린다.
  if (isSeatColumn(items, from)) throw new Error('자습·LAB 열의 이름은 바꿀 수 없습니다.');
  // 시간이 덜 정해진 수업의 줄도 함께 바꾼다 — 안 그러면 나중에 옛 이름의 열이 다시 생긴다.
  for (const p of draft.placements) if ((draft.cells[p.row]?.[4]?.text || '담당 미정') === from) next.cells[p.row][4] = cell(draft, p.row, value);
  columns[columns.indexOf(from)] = value;
  const look = next.appearance;
  if (look) {
    for (const map of [look.teacherColors, look.teacherNicknames] as Record<string, unknown>[]) {
      if (from in map) { map[value] = map[from]; delete map[from]; }
    }
    look.excludedTeachers = look.excludedTeachers.map(t => t === from ? value : t);
  }
  for (const info of Object.values(next.classes ?? {})) if (info.homeroomTeacher === from) info.homeroomTeacher = value;
  return next;
}
/** 수업이 남아 있으면 지우지 않는다 — 수업이 조용히 사라지지 않게. */
export function removeTeacher(draft: Draft, name: string): Draft {
  const { items, next, columns } = prepared(draft);
  requireColumn(columns, name);
  const left = items.filter(p => p.teacher === name).length;
  if (left) throw new Error(`${name} 열에 수업·일정 ${left}개가 남아 있습니다. 먼저 다른 강사에게 넘기거나 지워 주세요.`);
  next.teachers = columns.filter(t => t !== name);
  // 지운 이름을 가리키던 담임·색·별명도 함께 거둔다.
  for (const info of Object.values(next.classes ?? {})) if (info.homeroomTeacher === name) delete info.homeroomTeacher;
  const look = next.appearance;
  if (look) {
    delete look.teacherColors[name]; delete look.teacherNicknames[name];
    look.excludedTeachers = look.excludedTeachers.filter(t => t !== name);
  }
  return next;
}
export function moveTeacher(draft: Draft, name: string, step: -1 | 1): Draft {
  const { next, columns } = prepared(draft), at = columns.indexOf(name), to = at + step;
  requireColumn(columns, name);
  if (to < 0 || to >= columns.length) return draft;
  [columns[at], columns[to]] = [columns[to], columns[at]];
  return next;
}
/** 강사 열을 통째로 다른 열 앞에 놓는다(머리를 끌어다 놓기). `before`가 null이면 맨 뒤. 자리가 그대로면 연습본을 건드리지 않는다. */
export function placeTeacher(draft: Draft, name: string, before: string | null): Draft {
  const { next, columns } = prepared(draft);
  requireColumn(columns, name);
  if (before !== null) requireColumn(columns, before);
  if (before === name) return draft;
  const rest = columns.filter(t => t !== name);
  rest.splice(before === null ? rest.length : rest.indexOf(before), 0, name);
  if (rest.every((t, i) => t === columns[i])) return draft;
  next.teachers = rest;
  return next;
}
/** 한 강사의 수업·일정을 모두 다른 강사에게 넘긴다. 요일·시간·학생은 그대로다. */
export function reassignTeacher(draft: Draft, from: string, to: string): Draft {
  return exchange(draft, from, to, false);
}
/** 두 강사의 수업·일정을 통째로 맞바꾼다. */
export function swapTeachers(draft: Draft, a: string, b: string): Draft {
  return exchange(draft, a, b, true);
}
function exchange(draft: Draft, a: string, b: string, both: boolean): Draft {
  const { items, next, columns } = prepared(draft);
  requireColumn(columns, a); requireColumn(columns, b);
  if (a === b) throw new Error('다른 강사를 선택해 주세요.');
  if (isSeatColumn(items, a) || isSeatColumn(items, b)) throw new Error('자습·LAB 열의 수업은 강사에게 넘길 수 없습니다.');
  const moving = items.filter(p => p.teacher === a || (both && p.teacher === b));
  if (!moving.length) throw new Error(`${a} 열에 넘길 수업이 없습니다.`);
  if (moving.some(p => p.locked)) throw new Error('잠근 수업이 있습니다. 잠금을 풀고 다시 해 주세요.');
  const idOf = (name: string) => items.find(p => p.teacher === name && p.teacherId)?.teacherId ?? null, ids = { [a]: idOf(a), [b]: idOf(b) };
  const target = new Map(moving.map(p => [p.id, p.teacher === a ? b : a]));
  for (const p of moving) next.cells[p.row][4] = cell(draft, p.row, target.get(p.id)!);
  next.placements = next.placements.map(p => target.has(p.id) ? { ...p, teacherId: ids[target.get(p.id)!] } : p);
  return next;
}
