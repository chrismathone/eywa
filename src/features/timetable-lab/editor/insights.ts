import { copyBlocks, moveBlocks, type Position } from './block-commands';
import { reasonOf } from './reason';
import { classList } from './class-commands';
import { validate } from './constraints';
import { labelsOf, lessons, type Draft, type Lesson } from './model';
import { teacherColumns } from './teachers';

export type MovePreview = { ok: boolean; added: number; reason: string };
/**
 * 수업을 그 자리에 놓으면 어떻게 되는지 **놓기 전에** 알려 준다. 연습본은 바꾸지 않는다.
 * 겹침은 막지 않는다(자유 배치) — 새로 생기는 겹침의 수와 이유만 말한다.
 */
export function previewMove(draft: Draft, ids: string[], anchorId: string, to: Position, copy = false, known?: Set<string>): MovePreview {
  try {
    const source = lessons(draft).items;
    const next = copy ? copyBlocks(draft, source.filter(p => ids.includes(p.id)), anchorId, to) : moveBlocks(draft, ids, anchorId, to);
    // 끄는 동안 여러 번 불린다 — 지금의 겹침 목록은 호출하는 쪽이 한 번만 계산해 넘길 수 있다.
    const before = known ?? issueKeys(draft);
    const fresh = validate(next).issues.filter(i => !before.has(i.key));
    return { ok: true, added: fresh.length, reason: fresh[0]?.message ?? '' };
  } catch (error) {
    return { ok: false, added: 0, reason: reasonOf(error, '여기에는 놓을 수 없습니다.') };
  }
}

export const issueKeys = (draft: Draft) => new Set(validate(draft).issues.map(i => i.key));

const minutes = (items: Lesson[]) => items.reduce((sum, p) => sum + p.end - p.start, 0);
/** 연습본의 주간 요약 — 강사별 수업 시간, 강의실 사용, 반 인원, 학생 수. 화면이 바뀔 때마다 다시 센다. */
export function draftStats(draft: Draft) {
  const all = lessons(draft).items, taught = all.filter(p => p.kind !== 'block' && p.kind !== 'seat');
  const teachers = teacherColumns(draft, all).map(name => {
    const mine = taught.filter(p => p.teacher === name), blocks = all.filter(p => p.teacher === name && p.kind === 'block');
    return { name, lessons: mine.length, minutes: minutes(mine), days: new Set(mine.map(p => p.day)).size, blockMinutes: minutes(blocks) };
  });
  const roomNames = [...new Set(taught.map(p => p.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  const rooms = roomNames.map(room => {
    const mine = taught.filter(p => p.room === room);
    return { room, lessons: mine.length, minutes: minutes(mine) };
  });
  const classes = classList(draft).map(c => ({ id: c.id, name: c.name, students: c.students.length, lessons: c.items.length, minutes: minutes(c.items) }));
  const enrolled = new Map<string, Set<string>>();
  for (const c of classList(draft)) for (const id of c.students) enrolled.set(id, (enrolled.get(id) ?? new Set()).add(c.id));
  const names = labelsOf(draft);
  return {
    teachers, rooms, classes,
    students: { total: enrolled.size, multi: [...enrolled.values()].filter(set => set.size > 1).length,
      unassigned: Object.keys(names).filter(id => !enrolled.has(id)).length },
    noRoom: taught.filter(p => !p.room).length,
    issues: validate(draft).issues.length,
  };
}
/** 시수 표기: 90분 → "1시간 30분". */
export function hoursLabel(total: number) {
  const h = Math.floor(total / 60), m = total % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
}
