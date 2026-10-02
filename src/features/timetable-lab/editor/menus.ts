import { removeBlocks, type Position } from './block-commands';
import { classList } from './class-commands';
import type { EditorActions, MenuItem } from './editor-actions';
import { deleteClass, duplicateBelow, duplicateToDays, setLocked, shiftBlocks, swapBlocks } from './item-commands';
import { days, labelsOf, lessons, type Draft, type Lesson } from './model';
import { addStudentToClass, removeStudentFromClass } from './roster-commands';
import { moveTeacher, removeTeacher, teacherColumns } from './teachers';

/** 고른 수업들에 대한 동작 — 우클릭 메뉴와 선택 도구줄이 같은 목록을 쓴다. */
export function blockMenu(draft: Draft, item: Lesson, selected: string[], actions: EditorActions): MenuItem[] {
  const ids = selected.includes(item.id) ? selected : [item.id];
  const all = lessons(draft).items, chosen = all.filter(p => ids.includes(p.id)), step = draft.source?.step ?? 10;
  const locked = chosen.length > 0 && chosen.every(p => p.locked), many = ids.length > 1;
  const free = days.slice(0, 6).filter(day => !chosen.some(p => p.day === day));
  return [
    { label: '자세히 보기·고치기', hint: 'Enter', run: () => { actions.select(ids); actions.details(); } },
    { label: '바로 아래에 복제', hint: 'Ctrl+D', run: () => actions.run('수업 복제', d => duplicateBelow(d, ids), '바로 아래에 복제했습니다.') },
    ...free.map(day => ({ label: `${day}요일에도 놓기`, run: () => actions.run('다른 요일에 복사', d => duplicateToDays(d, ids, [day]), `${day}요일에도 같은 수업을 놓았습니다.`) })),
    null,
    { label: `${step}분 앞으로`, hint: 'Alt+↑', run: () => actions.run('수업 시간 밀기', d => shiftBlocks(d, ids, -step)) },
    { label: `${step}분 뒤로`, hint: 'Alt+↓', run: () => actions.run('수업 시간 밀기', d => shiftBlocks(d, ids, step)) },
    { label: '두 수업 자리 맞바꾸기', disabled: ids.length !== 2, run: () => actions.run('수업 맞바꾸기', d => swapBlocks(d, ids[0], ids[1]), '두 수업의 자리를 맞바꿨습니다.') },
    null,
    { label: locked ? '잠금 풀기' : '잠그기(실수로 못 옮기게)', run: () => actions.run(locked ? '잠금 풀기' : '수업 잠금', d => setLocked(d, ids, !locked), locked ? '잠금을 풀었습니다.' : '잠갔습니다. 옮기거나 지울 수 없습니다.') },
    { label: `${item.name} 수업 모두 고르기`, disabled: !item.classId, run: () => actions.select(all.filter(p => p.classId === item.classId).map(p => p.id)) },
    null,
    { label: many ? `${ids.length}개 지우기` : '지우기', hint: 'Delete', danger: true,
      run: () => { if (actions.run('수업 배치 지우기', d => removeBlocks(d, ids), '지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.')) actions.select([]); } },
  ];
}
/** 빈 칸에서 여는 메뉴 — 그 자리에 바로 만든다. */
export function slotMenu(at: Position, actions: EditorActions): MenuItem[] {
  const seed = { day: at.day, teacher: at.teacher, start: at.start };
  return [
    { label: '여기에 수업 추가', hint: 'Insert', run: () => actions.openAdd({ ...seed, kind: 'lesson' }) },
    { label: '여기에 새 반 만들기', run: () => actions.openAdd({ ...seed, kind: 'class' }) },
    { label: '여기에 회의·일정 추가', run: () => actions.openAdd({ ...seed, kind: 'block' }) },
  ];
}
export function teacherMenu(draft: Draft, teacher: string, actions: EditorActions): MenuItem[] {
  const columns = teacherColumns(draft), at = columns.indexOf(teacher);
  const mine = lessons(draft).items.filter(p => p.teacher === teacher).map(p => p.id);
  return [
    { label: `${teacher} 열에 수업 추가`, run: () => actions.openAdd({ kind: 'lesson', teacher }) },
    { label: `${teacher} 열에 회의·일정 추가`, run: () => actions.openAdd({ kind: 'block', teacher }) },
    { label: `${teacher} 수업 모두 고르기`, disabled: !mine.length, run: () => { actions.select(mine); actions.announce(`${teacher} 강사의 수업 ${mine.length}개를 골랐습니다. 함께 옮기거나 아래 도구줄로 한꺼번에 바꿀 수 있습니다.`); } },
    null,
    { label: '왼쪽으로 옮기기', disabled: at <= 0, run: () => actions.run('강사 순서 변경', d => moveTeacher(d, teacher, -1)) },
    { label: '오른쪽으로 옮기기', disabled: at < 0 || at >= columns.length - 1, run: () => actions.run('강사 순서 변경', d => moveTeacher(d, teacher, 1)) },
    { label: '이름 바꾸기·수업 넘기기…', run: () => actions.openManage('teachers') },
    null,
    { label: '새 강사 열 추가', run: () => actions.openAdd({ kind: 'teacher' }) },
    { label: '이 열 지우기', danger: true, run: () => actions.run('강사 열 지우기', d => removeTeacher(d, teacher), `${teacher} 열을 지웠습니다.`) },
  ];
}
export function classMenu(draft: Draft, classId: string, actions: EditorActions): MenuItem[] {
  const group = classList(draft).find(c => c.id === classId);
  if (!group) return [];
  return [
    { label: '이름·담임·색·학생 고치기', run: () => { actions.select(group.items.map(p => p.id)); actions.details(); } },
    { label: '이 반에 수업 추가', run: () => actions.openAdd({ kind: 'lesson', classId, teacher: group.items[0]?.teacher }) },
    { label: '학생 관리 열기', run: () => actions.openManage('students') },
    null,
    { label: `${group.name} 반 지우기`, danger: true, run: () => { if (actions.run('반 지우기', d => deleteClass(d, classId), `${group.name} 반과 수업 ${group.items.length}개를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`)) actions.select([]); } },
  ];
}
export function studentMenu(draft: Draft, studentId: string, classId: string, actions: EditorActions): MenuItem[] {
  const name = labelsOf(draft)[studentId] ?? '이름 미확인', groups = classList(draft);
  const others = groups.filter(c => c.id !== classId && !c.students.includes(studentId));
  return [
    { label: `${name} 주간 동선 보기`, run: () => actions.focusStudent(studentId) },
    { label: '학생 관리 열기(이름·수업 요일)', run: () => actions.openManage('students') },
    null,
    ...others.slice(0, 12).map(c => ({ label: `${c.name}에도 넣기(두 반 수강)`, run: () => actions.run('학생을 반에 추가', d => addStudentToClass(d, studentId, c.id), `${name} 학생을 ${c.name}에도 넣었습니다.`) })),
    others.length ? null : { label: '넣을 다른 반이 없습니다', disabled: true, run: () => {} },
    { label: '이 반에서 빼기', danger: true, run: () => actions.run('학생을 반에서 빼기', d => removeStudentFromClass(d, studentId, classId), `${name} 학생을 이 반에서 뺐습니다. 다른 반 배정은 그대로입니다.`) },
  ];
}
