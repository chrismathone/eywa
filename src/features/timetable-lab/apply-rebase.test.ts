import { describe, expect, it } from 'vitest';
import { applyFixture, uid } from './apply-plan.test';
import { buildApplyPlan } from './apply-plan';
import { rebaseDraft } from './apply-rebase';
import { moveClassStudent } from './editor/class-commands';
import { lessons, type Draft } from './editor/model';
import type { ApplyContext } from './server/apply-context';

const date = '2026-10-08';
const plan = (draft: Draft, context: ApplyContext, changed = true) => {
  const latest = rebaseDraft(draft, context, date, changed);
  return { latest, plan: buildApplyPlan(latest.draft, latest.context, date) };
};
const move = (draft: Draft, row: number, start: string, end: string, day = '월') => { draft.cells[row][1].text = day; draft.cells[row][2].text = start; draft.cells[row][3].text = end; };
const addLesson = (draft: Draft, teacher = '강사', classId = uid(2), name = '반 2') => {
  const row = draft.cells.length;
  draft.cells.push([name, '화', '14:20', '15:00', teacher, '301'].map(text => ({ text })));
  draft.placements.push({ id: 'new-lesson', sourceScheduleId: null, classId, row, teacherId: uid(10), roomId: uid(20), kind: 'lesson', studentIds: [] });
};

describe('최신 운영 시간표로 다시 맞추기', () => {
  it('운영이 그대로면 연습본을 바꾸지 않는다', () => {
    const { draft, context } = applyFixture(); move(draft, 1, '11:10', '11:40');
    const { latest, plan: result } = plan(draft, context, false);
    expect(latest.notices).toEqual([]); expect(latest.skipped).toEqual([]);
    expect(result).toEqual(buildApplyPlan(draft, context, date));
  });
  it('연습본에서 안 건드린 수업이 운영에서 없어지면 그대로 둔다 — 반 종료로 읽지 않는다', () => {
    const { draft, context } = applyFixture();
    context.schedules = context.schedules.filter(row => row.id !== uid(31));
    const { latest, plan: result } = plan(draft, context);
    expect(result.summary).toEqual({ schedules: 0, blocks: 0, classes: 0, students: 0, enrollments: 0, teacherNames: 0 });
    expect(result.closedClasses).toEqual([]);
    expect(latest.notices.join()).toContain('1건');
    expect(latest.skipped).toEqual([]);
  });
  it('행 식별자만 바뀌었으면 새 행에 변경을 얹는다 — 옛 행도 새 수업도 겹치지 않는다', () => {
    const { draft, context } = applyFixture(); move(draft, 1, '11:10', '11:40');
    context.schedules[0] = { ...context.schedules[0], id: uid(35) };
    const { plan: result } = plan(draft, context);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].before?.id).toBe(uid(35));
    expect(result.schedules[0].item).toMatchObject({ start: 670, end: 700 });
  });
  it('이미 적용된 저장본을 다시 적용해도 수업이 두 번 들어가지 않는다', () => {
    const { draft, context } = applyFixture(); move(draft, 1, '14:20', '15:00', '화');
    context.schedules[0].validTo = '2026-10-07';
    context.schedules.push({ ...context.schedules[0], id: uid(35), day: 'tue', start: '14:20', end: '15:00', validFrom: date, validTo: null });
    const { latest, plan: result } = plan(draft, context);
    expect(result.schedules).toEqual([]);
    expect(latest.skipped).toEqual([]);
  });
  it('연습본에서 새로 만든 수업도 이미 운영에 있으면 다시 넣지 않는다', () => {
    const { draft, context } = applyFixture(); addLesson(draft);
    expect(buildApplyPlan(draft, context, date).schedules).toHaveLength(1);
    context.schedules.push({ ...context.schedules[1], id: uid(36), day: 'tue', start: '14:20', end: '15:00', validFrom: date });
    expect(plan(draft, context).plan.schedules).toEqual([]);
  });
  it('강사 영어 이름으로 적힌 새 수업도 같은 사람의 운영 행으로 찾는다', () => {
    const { draft, context } = applyFixture(); context.people[0].englishName = 'Hannah'; addLesson(draft, 'Hannah');
    context.schedules.push({ ...context.schedules[1], id: uid(36), day: 'tue', start: '14:20', end: '15:00', validFrom: date });
    expect(plan(draft, context).plan.schedules).toEqual([]);
  });
  it('적용일 뒤에 시작하는 운영 수업에 연결하지 않는다 — 그때까지 수업이 비지 않게 예약으로 거절한다', () => {
    for (const changed of [true, false]) {
      const { draft, context } = applyFixture(); addLesson(draft);
      context.schedules.push({ ...context.schedules[1], id: uid(36), day: 'tue', start: '14:20', end: '15:00', validFrom: '2026-10-20' });
      expect(() => plan(draft, context, changed)).toThrow('예약');
    }
  });
  it('앞선 적용일보다 이른 날로 다시 적용해도 새 일정을 또 넣지 않는다', () => {
    const { draft, context } = applyFixture(), row = draft.cells.length;
    draft.cells.push(['회의', '화', '14:20', '15:00', '강사', ''].map(text => ({ text })));
    draft.placements.push({ id: 'new-block', sourceScheduleId: null, classId: '', row, teacherId: uid(10), kind: 'block', studentIds: [] });
    context.blocks.push({ id: uid(90), teacherLabel: '강사', teacherId: uid(10), day: 'tue', start: '14:20', end: '15:00', kind: 'meeting', label: '회의', validFrom: '2026-10-20', validTo: null });
    expect(plan(draft, context).plan.blocks).toEqual([]);
  });
  it('앞서 적용한 새 수업을 운영이 옮겼으면 옛 시간에 또 넣지 않고 알린다', () => {
    const { draft, context } = applyFixture(); addLesson(draft);
    context.schedules.push({ ...context.schedules[1], id: uid(36), day: 'wed', start: '14:20', end: '15:00', validFrom: date });
    context.appliedNewIds = ['new-lesson'];
    const { latest, plan: result } = plan(draft, context);
    expect(result.schedules).toEqual([]);
    expect(latest.skipped).toHaveLength(1);
  });
  it('적용한 적 없는 새 수업은 그대로 넣는다', () => {
    const { draft, context } = applyFixture(); addLesson(draft); context.appliedNewIds = ['other'];
    expect(plan(draft, context).plan.schedules).toHaveLength(1);
  });
  it('운영이 같은 자리 수업의 강사를 바꿨으면 새 수업을 겹쳐 넣지 않고 알린다', () => {
    const { draft, context } = applyFixture(); addLesson(draft);
    context.people.push({ ...context.people[0], id: uid(11), name: '둘째' });
    context.schedules.push({ ...context.schedules[1], id: uid(36), day: 'tue', start: '14:20', end: '15:00', validFrom: date, teacherId: uid(11), teacherLabel: '둘째' });
    const { latest, plan: result } = plan(draft, context);
    expect(result.schedules).toEqual([]);
    expect(latest.skipped).toHaveLength(1);
  });
  it('운영이 이미 맞바꾼 교시에 강의실 변경만 얹는다 — 운영도 강의실을 바꿨으면 운영 값을 남긴다', () => {
    const { draft, context } = applyFixture();
    // 같은 반 두 교시를 강사만 맞바꾼 연습본
    const second = draft.source!.initialPlacements![uid(32)];
    draft.placements[1].classId = uid(1); draft.placements[1].studentIds = [uid(50)]; draft.cells[2][0].text = '반 1';
    Object.assign(second, { classId: uid(1), name: '반 1', teacher: '둘째', students: [uid(50)] });
    context.people.push({ ...context.people[0], id: uid(11), name: '둘째' });
    draft.cells[1][4].text = '둘째'; draft.cells[2][4].text = '강사'; draft.cells[1][5].text = '602';
    context.rooms.push({ id: uid(21), name: '602' });
    const swapped = (roomLabel: string | null) => [
      { ...context.schedules[0], id: uid(35), teacherId: uid(11), teacherLabel: '둘째', roomLabel },
      { ...context.schedules[1], id: uid(36), classId: uid(1), teacherId: uid(10), teacherLabel: '강사', roomLabel },
    ];
    const both = { ...context, schedules: swapped('305') };
    expect(plan(draft, both).latest.skipped.join()).toContain('강의실');
    expect(plan(draft, both).plan.schedules).toEqual([]);
    const { latest, plan: result } = plan(draft, { ...context, schedules: swapped(null) });
    expect(latest.skipped).toEqual([]);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toMatchObject({ before: { id: uid(35) }, roomId: uid(21), teacherId: uid(11) });
  });
  it('양쪽이 같은 수업을 다르게 바꾸면 최신 시간표를 남기고 알린다', () => {
    const { draft, context } = applyFixture(); move(draft, 1, '14:20', '15:00', '수');
    context.schedules[0] = { ...context.schedules[0], id: uid(35), day: 'tue' };
    const { latest, plan: result } = plan(draft, context);
    expect(result.schedules).toEqual([]);
    expect(result.removedSchedules).toEqual([]);
    expect(result.enrollments).toEqual([]);
    expect(latest.skipped).toEqual([expect.stringContaining('적용 제외 · 반 1 · 수 14:20~15:00')]);
    expect(latest.draft.source!.importedClassIds).not.toContain(uid(1));
  });
  it('운영에서 반 이름이 바뀌고 옛 이름의 새 반이 생기면 바꾼 수업을 얹지 않는다', () => {
    const { draft, context } = applyFixture(); move(draft, 1, '14:20', '15:00', '수');
    context.classes[0].name = '반 1 특별';
    context.classes.push({ ...context.classes[0], id: uid(3), name: '반 1' });
    context.schedules[0] = { ...context.schedules[0], id: uid(35) };
    const { latest, plan: result } = plan(draft, context);
    expect(result.schedules).toEqual([]);
    expect(latest.skipped).toHaveLength(1);
  });
  it('운영에서 바뀐 반 이름을 따른다 — 기존 반과 이름이 겹친다며 막지 않는다', () => {
    const { draft, context } = applyFixture(); move(draft, 2, '12:10', '12:40');
    context.classes[0].name = '반 1 특별';
    context.classes.push({ ...context.classes[0], id: uid(3), name: '반 1' });
    const { latest, plan: result } = plan(draft, context);
    expect(result.classes).toEqual([]);
    expect(lessons(latest.draft).items.find(item => item.classId === uid(1))?.name).toBe('반 1 특별');
  });
  it('양쪽이 반 이름을 다르게 바꾸면 운영 이름을 남기고 알린다', () => {
    const { draft, context } = applyFixture(); draft.classes![uid(1)].name = '연습 이름'; context.classes[0].name = '운영 이름';
    const { latest, plan: result } = plan(draft, context);
    expect(result.classes).toEqual([]);
    expect(latest.skipped.join()).toContain('반 이름');
  });
  const newClass = (draft: Draft, context: ApplyContext) => {
    const created = uid(70), row = draft.cells.length;
    draft.cells.push(['새 반', '화', '14:20', '15:00', '강사', '301'].map(text => ({ text })));
    draft.placements.push({ id: 'new-class', sourceScheduleId: null, classId: created, row, teacherId: uid(10), roomId: uid(20), kind: 'lesson', studentIds: [] });
    context.classes.push({ ...context.classes[1], id: uid(3), name: '새 반' });
  };
  it('연습본에서 만든 새 반이 같은 이름으로 운영에 생겼으면 그 반으로 보고 알린다', () => {
    const { draft, context } = applyFixture(); newClass(draft, context);
    context.schedules.push({ ...context.schedules[1], id: uid(36), classId: uid(3), day: 'tue', start: '14:20', end: '15:00', validFrom: date });
    expect(() => buildApplyPlan(draft, context, date)).toThrow('겹칩니다');
    const { latest, plan: result } = plan(draft, context);
    expect(result.classes).toEqual([]); expect(result.schedules).toEqual([]);
    expect(latest.draft.source!.importedClassIds).toContain(uid(3));
    expect(latest.notices.join()).toContain('합쳤습니다');
  });
  it('운영이 그대로면 같은 이름의 반에 조용히 합치지 않는다', () => {
    const { draft, context } = applyFixture(); newClass(draft, context);
    expect(() => plan(draft, context, false)).toThrow('겹칩니다');
  });
  it('연습본에 없는 운영 수업은 그대로 두고 겹침은 함께 검사한다', () => {
    const { draft, context } = applyFixture();
    context.schedules.push({ ...context.schedules[1], id: uid(36), classId: uid(3), day: 'mon', start: '11:00', end: '11:40', validFrom: '2026-10-05' });
    context.classes.push({ ...context.classes[1], id: uid(3), name: '새 반' });
    const { latest, plan: result } = plan(draft, context);
    expect(result.summary.schedules).toBe(0);
    expect(result.warnings.join()).toContain('새 반');
    expect(latest.notices.join()).toContain('그대로 두고');
  });
  it('끝난 반에 남은 행은 겹침 검사에 넣지 않는다', () => {
    const { draft, context } = applyFixture();
    context.schedules.push({ ...context.schedules[1], id: uid(36), classId: uid(3), start: '11:00', end: '11:40' });
    context.classes.push({ ...context.classes[1], id: uid(3), name: '끝난 반', active: false });
    expect(plan(draft, context).plan.warnings).toEqual([]);
  });
  it('연습본에 없는 운영 수업의 요일은 등원 요일에서 빼지 않는다', () => {
    const { draft, context } = applyFixture(); move(draft, 1, '14:20', '15:00', '수');
    context.schedules.push({ ...context.schedules[0], id: uid(36), day: 'fri', validFrom: '2026-10-05' });
    const { plan: result } = plan(draft, context);
    expect(result.enrollments[0].days.sort()).toEqual(['fri', 'wed']);
  });
  it('운영에서 바뀐 학생 이름을 옛 이름으로 되돌리지 않고 알린다', () => {
    const { draft, context } = applyFixture(); context.students[0].name = '바뀐 이름';
    const { latest, plan: result } = plan(draft, context);
    expect(result.students).toEqual([]);
    expect(latest.skipped.join()).toContain('학생 이름 1건');
  });
  it('운영이 그대로면 연습본의 학생 이름 변경은 적용한다', () => {
    const { draft, context } = applyFixture(); draft.people![uid(50)] = '새 이름';
    expect(plan(draft, context, false).plan.students).toMatchObject([{ id: uid(50), name: '새 이름', beforeName: '학생' }]);
  });
  it('운영에서 바뀐 강사 이름을 옛 이름으로 되돌리지 않는다', () => {
    const { draft, context } = applyFixture(); context.people[0].name = '강사 개명'; addLesson(draft);
    expect(buildApplyPlan(draft, context, date).people).toHaveLength(1);
    const { plan: result } = plan(draft, context);
    expect(result.people).toEqual([]);
    expect(result.schedules[0].item.teacher).toBe('강사 개명');
  });
  it('운영에서 바뀐 강사 이름이 강사 순서 변경으로 잡히지 않는다', () => {
    const { draft, context } = applyFixture(); context.people[0].name = '강사 개명';
    draft.source!.initialTeacherOrder = ['강사'];
    const { latest } = plan(draft, context);
    expect(latest.draft.teachers).toEqual(['강사 개명']);
    expect(latest.draft.source!.initialTeacherOrder).toEqual(['강사 개명']);
  });
  it('연습본이 수업을 다 넘긴 옛 강사를 운영이 개명해도 넘긴 수업은 그대로 적용한다', () => {
    const { draft, context } = applyFixture(); context.people.push({ ...context.people[0], id: uid(11), name: '둘째' });
    context.people[0].name = '강사 개명'; draft.cells[1][4].text = '둘째'; draft.cells[2][4].text = '둘째';
    const { latest, plan: result } = plan(draft, context);
    expect(latest.skipped).toEqual([]);
    expect(result.schedules).toHaveLength(2);
  });
  it('양쪽이 강사를 다르게 바꿔도 담임 이름 때문에 막히지 않는다', () => {
    const { draft, context } = applyFixture(); context.people.push({ ...context.people[0], id: uid(11), name: '둘째' }, { ...context.people[0], id: uid(12), name: '셋째' });
    context.schedules[0] = { ...context.schedules[0], teacherId: uid(11), teacherLabel: '둘째' };
    draft.cells[1][4].text = '셋째'; draft.classes![uid(1)].homeroomTeacher = '셋째'; draft.source!.initialClasses![uid(1)].homeroomTeacher = '강사';
    const { latest } = plan(draft, context);
    expect(latest.skipped.join()).toContain('강사');
  });
  it('연습본에서 지은 강사 이름은 그대로 적용한다', () => {
    const { draft, context } = applyFixture(); draft.cells[1][4].text = '새 이름'; draft.cells[2][4].text = '새 이름';
    expect(plan(draft, context).plan.people).toMatchObject([{ id: uid(10), name: '새 이름' }]);
  });
  it('앞선 적용으로 등록된 새 학생을 다시 등록하지 않는다', () => {
    const { draft, context } = applyFixture(), id = uid(60);
    draft.people![`new:${id}`] = '새 학생'; draft.placements[0].studentIds = [uid(50), `new:${id}`];
    context.students.push({ id, name: '새 학생', school: null, grade: null, status: 'enrolled' });
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: id, start: '2026-10-01' });
    const { plan: result } = plan(draft, context);
    expect(result.students).toEqual([]); expect(result.enrollments).toEqual([]);
  });
  it('운영에서 지워진 학생 때문에 막히지 않는다', () => {
    const { draft, context } = applyFixture(); context.students = []; context.enrollments = [];
    expect(plan(draft, context).plan.summary.students).toBe(0);
  });
  it('학생 겹침은 적용일의 최신 명단으로 검사한다', () => {
    const { draft, context } = applyFixture();
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51), classId: uid(2), start: '2026-10-01' });
    context.students.push({ id: uid(51), name: '합류', school: null, grade: null, status: 'enrolled' });
    context.outside = [{ ...context.schedules[1], id: uid(99), name: '수학', teacher: '다른 강사', room: '302', roomId: null, students: [uid(51)] }];
    const { plan: result } = plan(draft, context);
    expect(result.warnings.join()).toContain('학생 겹침');
    expect(result.enrollments).toEqual([]);
    expect(buildApplyPlan(draft, context, date).warnings).toEqual([]);
  });
  it('연습본에서 지운 수업은 행이 바뀌었어도 최신 행을 닫는다', () => {
    const { draft, context } = applyFixture();
    draft.placements = draft.placements.filter(row => row.sourceScheduleId !== uid(32));
    context.schedules[1] = { ...context.schedules[1], id: uid(36) };
    const { plan: result } = plan(draft, context);
    expect(result.removedSchedules.map(row => row.id)).toEqual([uid(36)]);
  });
  it('양쪽이 지웠으면 같은 반에 다른 강사의 운영 수업이 있어도 알리지 않는다', () => {
    const { draft, context } = applyFixture(); context.people.push({ ...context.people[0], id: uid(11), name: '둘째' });
    draft.placements = draft.placements.filter(row => row.sourceScheduleId !== uid(32));
    context.schedules[1] = { ...context.schedules[1], id: uid(36), start: '12:30', end: '13:10', teacherId: uid(11), teacherLabel: '둘째' };
    expect(plan(draft, context).latest.skipped.join()).not.toContain('삭제');
  });
  it('연습본에서 지운 수업을 운영이 다른 시간으로 옮겼으면 알린다', () => {
    const { draft, context } = applyFixture();
    draft.placements = draft.placements.filter(row => row.sourceScheduleId !== uid(32));
    context.schedules[1] = { ...context.schedules[1], id: uid(36), start: '12:30', end: '13:10' };
    const { latest, plan: result } = plan(draft, context);
    expect(result.removedSchedules).toEqual([]);
    expect(latest.skipped.join()).toContain('삭제');
  });
  it('원본 정보가 없는 옛 저장본은 계획 단계에서 거절된다', () => {
    const { draft, context } = applyFixture(); delete draft.source!.initialPlacements;
    expect(() => plan(draft, context)).toThrow('원본 버전');
  });
});

describe('강의실 비교', () => {
  it('행에 강의실 식별자만 있는 수업은 운영이 안 바꿨으면 연습본 변경을 적용한다', () => {
    const { draft, context } = applyFixture(); context.rooms.push({ id: uid(21), name: '602' });
    context.schedules[0] = { ...context.schedules[0], roomId: uid(21) }; draft.cells[1][5].text = '603';
    const { latest } = plan(draft, context);
    expect(latest.skipped).toEqual([]);
  });
  it('행이 교체되며 강의실이 바뀐 수업도 양쪽 변경을 알린다', () => {
    const { draft, context } = applyFixture(); draft.cells[1][5].text = '602';
    context.schedules[0] = { ...context.schedules[0], id: uid(35), roomLabel: '603' };
    const { latest, plan: result } = plan(draft, context);
    expect(latest.skipped.join()).toContain('강의실');
    expect(result.schedules).toEqual([]);
  });
});

describe('학생 이동은 한 건으로 다룬다', () => {
  const moved = () => {
    const fixture = applyFixture();
    fixture.context.enrollments.push({ ...fixture.context.enrollments[0], id: uid(41), classId: uid(3), start: '2026-01-01' });
    return { ...fixture, draft: moveClassStudent(fixture.draft, uid(50), uid(1), uid(2)) };
  };
  it('들어갈 반의 수업이 빠지면 나오는 쪽도 적용하지 않는다', () => {
    const { draft, context } = moved();
    context.schedules = context.schedules.filter(row => row.id !== uid(32));
    const { latest, plan: result } = plan(draft, context);
    expect(result.enrollments).toEqual([]);
    expect(latest.skipped.join()).toContain('학생 이동');
  });
  it('나올 반의 수업이 빠지면 들어가는 쪽도 적용하지 않는다', () => {
    const { draft, context } = moved();
    context.schedules = context.schedules.filter(row => row.id !== uid(31));
    const { latest, plan: result } = plan(draft, context);
    expect(result.enrollments).toEqual([]);
    expect(latest.skipped.join()).toContain('학생 이동');
  });
  it('운영이 먼저 다른 반으로 옮겼으면 이중 수강을 만들지 않는다', () => {
    const { draft, context } = moved();
    context.enrollments = context.enrollments.filter(row => row.classId !== uid(1));
    const { latest, plan: result } = plan(draft, context);
    expect(result.enrollments).toEqual([]);
    expect(latest.skipped.join()).toContain('학생 이동');
  });
  it('이미 같은 반으로 옮겨져 있으면 아무 일도 하지 않고 알리지도 않는다', () => {
    const { draft, context } = moved();
    context.enrollments = context.enrollments.map(row => row.classId === uid(1) ? { ...row, classId: uid(2), id: uid(44) } : row);
    const { latest, plan: result } = plan(draft, context);
    expect(result.enrollments).toEqual([]);
    expect(latest.skipped).toEqual([]);
  });
  const merged = () => {
    // 반 1을 반 2로 합친다 — 반 1 수업을 지우고 학생을 반 2로 옮긴다.
    const { draft, context } = applyFixture();
    const next = moveClassStudent(draft, uid(50), uid(1), uid(2));
    next.placements = next.placements.filter(row => row.classId !== uid(1));
    return { draft: next, context };
  };
  it('합치는 반에 운영이 새 학생을 넣었으면 반도 닫지 않고 이동도 적용하지 않는다', () => {
    const { draft, context } = merged();
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51) });
    context.students.push({ id: uid(51), name: '합류', school: null, grade: null, status: 'enrolled' });
    const { latest, plan: result } = plan(draft, context);
    expect(result.enrollments).toEqual([]);
    expect(result.closedClasses).toEqual([]);
    expect(result.removedSchedules).toEqual([]);
    expect(latest.skipped.join()).toContain('학생 이동');
    expect(latest.skipped.join()).toContain('반 종료');
  });
  it('합칠 때 한 학생의 이동이 빠지면 같은 반의 다른 학생도 함께 빠진다', () => {
    const { draft, context } = merged();
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51) });
    context.students.push({ id: uid(51), name: '둘째 학생', school: null, grade: null, status: 'enrolled' });
    draft.source!.initialStudents![uid(1)].push(uid(51));
    draft.source!.initialPlacements![uid(31)].students.push(uid(51));
    draft.placements[0].studentIds = [uid(50), uid(51)];
    context.schedules = context.schedules.filter(row => row.id !== uid(32));
    const { plan: result } = plan(draft, context);
    expect(result.enrollments).toEqual([]);
    expect(result.closedClasses).toEqual([]);
  });
  it('운영에서 그대로면 합치기는 예전처럼 적용한다', () => {
    const { draft, context } = merged();
    const { latest, plan: result } = plan(draft, context);
    expect(latest.skipped).toEqual([]);
    expect(result.closedClasses.map(row => row.id)).toEqual([uid(1)]);
    expect(result.enrollments).toHaveLength(2);
  });
  it('학생이 모두 빠진 새 반은 만들지 않는다', () => {
    const { draft, context } = applyFixture(), created = uid(70), row = draft.cells.length;
    draft.cells.push(['새 반', '수', '14:20', '15:00', '강사', '301'].map(text => ({ text })));
    draft.placements.push({ id: 'split', sourceScheduleId: null, classId: created, row, teacherId: uid(10), roomId: uid(20), kind: 'lesson', studentIds: [uid(50)] });
    draft.placements[0].studentIds = []; draft.students[uid(1)] = []; draft.students[created] = [uid(50)];
    context.schedules = context.schedules.filter(item => item.id !== uid(31));
    const { latest, plan: result } = plan(draft, context);
    expect(result.classes).toEqual([]); expect(result.schedules).toEqual([]); expect(result.enrollments).toEqual([]);
    expect(latest.skipped.join()).toContain('새 반');
  });
  const lessonForClass = (draft: Draft, day: string, studentIds: string[]) => {
    const row = draft.cells.length;
    draft.cells.push(['반 1', day, '14:20', '15:00', '강사', '301'].map(text => ({ text })));
    draft.placements.push({ id: 'added', sourceScheduleId: null, classId: uid(1), row, teacherId: uid(10), roomId: uid(20), kind: 'lesson', studentIds });
  };
  it('새 수업에 복사된 옛 명단이 운영에서 나간 학생을 되살리지 않는다', () => {
    const { draft, context } = applyFixture(); lessonForClass(draft, '화', [uid(50)]);
    context.enrollments = context.enrollments.map(row => ({ ...row, classId: uid(3) }));
    expect(plan(draft, context).plan.enrollments).toEqual([]);
  });
  it('같은 요일 새 수업은 그 요일 명단을 따라 막히지 않는다', () => {
    const { draft, context } = applyFixture(); lessonForClass(draft, '월', [uid(50)]);
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51) });
    context.students.push({ id: uid(51), name: '합류', school: null, grade: null, status: 'enrolled' });
    expect(plan(draft, context).plan.enrollments).toEqual([]);
  });
  it('연습본이 모르는 학생의 수강을 지운 수업 때문에 끝내지 않는다', () => {
    const { draft, context } = applyFixture();
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51), days: ['mon'] });
    context.students.push({ id: uid(51), name: '합류', school: null, grade: null, status: 'enrolled' });
    context.enrollments.push({ ...context.enrollments[0], id: uid(42), studentId: uid(51), classId: uid(3) });
    draft.placements = draft.placements.filter(row => row.sourceScheduleId !== uid(31));
    expect(plan(draft, context).plan.enrollments.filter(row => row.studentId === uid(51))).toEqual([]);
  });
  it('퇴원한 학생의 열린 수강은 명단에 넣지 않는다', () => {
    const { draft, context } = applyFixture(); context.students[0].status = 'withdrawn'; move(draft, 1, '14:20', '15:00', '수');
    expect(plan(draft, context).plan.enrollments).toEqual([]);
  });
  it('운영에서 뺀 등원 요일을 수업을 옮기며 되살리지 않는다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['tue']; move(draft, 1, '14:20', '15:00', '수');
    context.schedules.push({ ...context.schedules[0], id: uid(36), day: 'tue', validFrom: '2026-10-05' });
    expect(plan(draft, context).plan.enrollments).toEqual([]);
  });
  it('새 학생이 든 수업이 빠지면 수강 없는 재원생을 만들지 않는다', () => {
    const { draft, context } = applyFixture(), id = `new:${uid(60)}`;
    draft.people![id] = '새 학생'; draft.placements[1].studentIds = [id]; draft.students[uid(2)] = [id];
    context.schedules = context.schedules.filter(row => row.id !== uid(32));
    const { latest, plan: result } = plan(draft, context);
    expect(result.students).toEqual([]);
    expect(Object.values(latest.draft.students).flat()).not.toContain(id);
  });
  const secondLesson = (draft: Draft, context: ApplyContext, day = '수', enumDay = 'wed') => {
    const row = draft.cells.length, id = uid(36);
    draft.cells.push(['반 1', day, '14:20', '15:00', '강사', '301'].map(text => ({ text })));
    draft.placements.push({ id, sourceScheduleId: id, classId: uid(1), row, teacherId: uid(10), roomId: uid(20), kind: 'lesson', studentIds: [uid(50)] });
    draft.source!.importedIds!.push(id);
    draft.source!.initialPlacements![id] = { name: '반 1', classId: uid(1), day, start: 860, end: 900, teacher: '강사', room: '301', labSeparate: false, students: [uid(50)] };
    context.schedules.push({ ...context.schedules[0], id, day: enumDay, start: '14:20', end: '15:00' });
  };
  it('이동이 취소된 학생은 나가려던 반의 지운 수업 때문에 수강이 끝나지 않고 그 수업도 남는다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['mon'];
    const moved = moveClassStudent(draft, uid(50), uid(1), uid(2));
    addLesson(moved, '강사', uid(1), '반 1');
    moved.placements = moved.placements.filter(row => row.sourceScheduleId !== uid(31));
    context.schedules[1] = { ...context.schedules[1], id: uid(37), start: '13:00', end: '13:40' };
    const { latest, plan: result } = plan(moved, context);
    expect(latest.skipped.join()).toContain('학생 이동');
    expect(latest.skipped.join()).toContain('삭제');
    expect(result.enrollments).toEqual([]);
    expect(result.removedSchedules).toEqual([]);
  });
  const secondStudent = (draft: Draft, context: ApplyContext) => {
    context.students.push({ ...context.students[0], id: uid(51), name: '둘째 학생' });
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51) });
    for (const placement of draft.placements) if (placement.classId === uid(1)) placement.studentIds = [...placement.studentIds ?? [], uid(51)];
    for (const row of Object.values(draft.source!.initialPlacements!)) if (row.classId === uid(1)) row.students = [...row.students, uid(51)];
    draft.students[uid(1)] = [uid(50), uid(51)]; draft.source!.initialStudents![uid(1)] = [uid(50), uid(51)]; draft.people![uid(51)] = '둘째 학생';
  };
  it('옮긴 수업과 그날 수업의 명단이 연습본부터 다르면 거절한다 — 한쪽을 따라 학생을 빼지 않는다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); secondStudent(draft, context); context.enrollments[0].days = ['wed'];
    draft.placements[0].studentIds = [uid(51)]; draft.source!.initialPlacements![uid(31)].students = [uid(51)];
    move(draft, draft.cells.length - 1, '14:20', '15:00', '월');
    expect(() => plan(draft, context)).toThrow('교시별 명단');
  });
  it('운영이 수요일로 제한한 학생은 수요일 수업을 따라 월요일로 옮긴다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); secondStudent(draft, context); context.enrollments[0].days = ['wed'];
    move(draft, draft.cells.length - 1, '14:20', '15:00', '월');
    expect(plan(draft, context).plan.enrollments).toContainEqual(expect.objectContaining({ studentId: uid(50), days: ['mon'], remove: false }));
  });
  it('수업 두 개를 같은 요일로 옮겨도 운영의 요일 제한 때문에 거절하지 않는다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); secondStudent(draft, context); context.enrollments[0].days = ['mon'];
    move(draft, 1, '14:20', '15:00', '화'); move(draft, draft.cells.length - 1, '15:00', '15:40', '화');
    expect(plan(draft, context).plan.enrollments.filter(row => row.remove)).toEqual([]);
  });
  it('운영이 요일을 불러온 다른 수업으로 바꾼 학생도 옮기면 나가는 반을 끝낸다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); context.enrollments[0].days = ['wed'];
    draft.placements.find(row => row.id === uid(36))!.studentIds = []; draft.source!.initialPlacements![uid(36)].students = [];
    const result = plan(moveClassStudent(draft, uid(50), uid(1), uid(2)), context).plan.enrollments;
    expect(result.find(row => row.classId === uid(1))).toMatchObject({ remove: true });
    expect(result.find(row => row.classId === uid(2))).toMatchObject({ remove: false });
  });
  it('운영이 요일을 불러온 다른 수업으로 바꾼 학생이 든 반을 합치면 그 반 수강도 끝낸다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); context.enrollments[0].days = ['wed'];
    draft.placements.find(row => row.id === uid(36))!.studentIds = []; draft.source!.initialPlacements![uid(36)].students = [];
    const moved = moveClassStudent(draft, uid(50), uid(1), uid(2));
    moved.placements = moved.placements.filter(row => row.classId !== uid(1));
    const result = plan(moved, context).plan;
    expect(result.closedClasses.map(row => row.id)).toEqual([uid(1)]);
    expect(result.enrollments.find(row => row.classId === uid(1))).toMatchObject({ remove: true });
  });
  it('수업 행이 다른 반으로 넘어가면 그 수업의 학생은 빠지지 않는다', () => {
    const { draft, context } = applyFixture();
    draft.placements[0].classId = uid(2); draft.cells[1][0].text = '반 2'; draft.students[uid(2)] = [uid(50)]; move(draft, 1, '14:20', '15:00', '화');
    expect(plan(draft, context, false).plan).toEqual(buildApplyPlan(draft, context, date));
    expect(plan(draft, context).plan.enrollments.find(row => row.classId === uid(2))).toMatchObject({ studentId: uid(50), remove: false });
  });
  it('운영이 그 수업으로 옮긴 학생이 있으면 연습본이 지운 수업을 남긴다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); secondStudent(draft, context);
    context.enrollments[1].days = ['mon']; draft.placements.find(row => row.id === uid(36))!.studentIds = [uid(51)]; draft.source!.initialPlacements![uid(36)].students = [uid(51)];
    context.enrollments[0].days = ['wed'];
    draft.placements = draft.placements.filter(row => row.id !== uid(36));
    const { latest, plan: result } = plan(draft, context);
    expect(result.removedSchedules).toEqual([]);
    expect(latest.skipped.join()).toContain('삭제');
    expect(result.enrollments.filter(row => row.studentId === uid(50))).toEqual([]);
  });
  it('운영이 나머지 수업을 없앴으면 연습본이 지운 수업을 남겨 반이 빈 채로 남지 않는다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context);
    context.schedules[0] = { ...context.schedules[0], id: uid(37), start: '09:00', end: '09:40' };
    draft.placements = draft.placements.filter(row => row.id !== uid(36));
    const { latest, plan: result } = plan(draft, context);
    expect(result.removedSchedules).toEqual([]);
    expect(latest.skipped.join()).toContain('삭제');
    expect(result.enrollments).toEqual([]);
  });
  it('연습본이 뺀 학생은 그 수업의 요일을 옮겨도 나간 것으로 읽는다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['mon', 'fri'];
    context.schedules.push({ ...context.schedules[0], id: uid(36), day: 'fri', validFrom: '2026-10-05' });
    draft.placements[0].studentIds = []; move(draft, 1, '14:20', '15:00', '화');
    expect(() => plan(draft, context)).toThrow('수강 종료할 수 없습니다');
  });
  it('운영 수업에 다니는 학생은 다른 요일 수업이 지워져도 그 반에 남는다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['mon', 'fri'];
    context.schedules.push({ ...context.schedules[0], id: uid(36), day: 'fri', validFrom: '2026-10-05' });
    addLesson(draft, '강사', uid(1), '반 1');
    draft.placements = draft.placements.filter(row => row.sourceScheduleId !== uid(31));
    expect(plan(draft, context).plan.enrollments).toEqual([expect.objectContaining({ studentId: uid(50), classId: uid(1), days: ['fri'], remove: false })]);
  });
  it('운영 수업에 다녀도 다른 반으로 옮기면 나가는 반을 끝낸다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['mon', 'fri'];
    context.schedules.push({ ...context.schedules[0], id: uid(36), day: 'fri', validFrom: '2026-10-05' });
    const moved = moveClassStudent(draft, uid(50), uid(1), uid(2));
    addLesson(moved, '강사', uid(1), '반 1');
    moved.placements = moved.placements.filter(row => row.sourceScheduleId !== uid(31));
    const result = plan(moved, context).plan.enrollments;
    expect(result.find(row => row.classId === uid(1))).toMatchObject({ remove: true });
    expect(result.find(row => row.classId === uid(2))).toMatchObject({ remove: false });
  });
  it('운영이 등원 요일을 바꿔 명단에서 빠진 학생은 옮기지 않는다 — 두 반에 겹치지 않는다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['fri'];
    context.schedules.push({ ...context.schedules[0], id: uid(36), day: 'fri', validFrom: '2026-10-05' });
    const { latest, plan: result } = plan(moveClassStudent(draft, uid(50), uid(1), uid(2)), context);
    expect(result.enrollments).toEqual([]);
    expect(latest.skipped.join()).toContain('학생 이동');
  });
  it('같은 요일로 옮긴 수업은 그날 명단을 따른다', () => {
    const { draft, context } = applyFixture(); secondLesson(draft, context); context.enrollments[0].days = ['mon'];
    move(draft, draft.cells.length - 1, '14:20', '15:00', '월');
    const result = plan(draft, context).plan;
    expect(result.enrollments).toEqual([]);
    expect(result.schedules).toHaveLength(1);
  });
  it('요일만 제한한 학생의 수업을 옮기면 등원 요일이 따라간다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days = ['mon'];
    move(draft, 1, '14:20', '15:00', '화');
    expect(plan(draft, context).plan.enrollments).toEqual([expect.objectContaining({ days: ['tue'], remove: false })]);
  });
  it('담임을 운영에서 이름이 바뀐 강사로 바꿔도 거절하지 않는다', () => {
    const { draft, context } = applyFixture();
    context.people.push({ ...context.people[0], id: uid(11), name: '둘째 개명' });
    context.schedules[1] = { ...context.schedules[1], teacherId: uid(11) };
    draft.cells[2][4].text = '둘째'; draft.source!.initialPlacements![uid(32)].teacher = '둘째';
    draft.classes![uid(1)] = { ...draft.classes![uid(1)], homeroomTeacher: '둘째' };
    const result = plan(draft, context).plan;
    expect(result.classes).toEqual([expect.objectContaining({ id: uid(1), teacherId: uid(11) })]);
  });
});

describe('연습본이 닫는 반', () => {
  const closing = () => { const fixture = applyFixture(); fixture.draft.placements = fixture.draft.placements.filter(row => row.classId !== uid(2)); return fixture; };
  it('운영이 그 반에 새 수업을 넣었으면 닫지 않고 알린다', () => {
    const { draft, context } = closing();
    context.schedules.push({ ...context.schedules[1], id: uid(36), day: 'tue', start: '14:20', end: '15:00', validFrom: '2026-10-05' });
    const { latest, plan: result } = plan(draft, context);
    expect(result.closedClasses).toEqual([]);
    expect(latest.skipped.join()).toContain('반 종료');
  });
  it('운영에서 그 반에 새 학생이 들어왔으면 닫지 않는다', () => {
    const { draft, context } = closing();
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51), classId: uid(2) });
    context.students.push({ id: uid(51), name: '합류', school: null, grade: null, status: 'enrolled' });
    expect(plan(draft, context).plan.closedClasses).toEqual([]);
  });
  it('운영 변경이 없으면 그대로 닫는다', () => {
    const { draft, context } = closing();
    expect(plan(draft, context).plan.closedClasses.map(row => row.id)).toEqual([uid(2)]);
  });
});

describe('표시 설정', () => {
  it('다시 연결한 수업의 메모는 원본을 따라가 변경으로 잡히지 않는다', () => {
    const { draft, context } = applyFixture();
    draft.placements[0].note = '메모'; draft.source!.initialSlotMetadata![uid(31)] = { note: '메모', locked: false };
    context.schedules[0] = { ...context.schedules[0], id: uid(35) };
    const latest = rebaseDraft(draft, context, date, true);
    expect(latest.draft.source!.initialSlotMetadata![uid(35)]).toEqual({ note: '메모', locked: false });
    expect(latest.draft.source!.initialSlotMetadata![uid(31)]).toBeUndefined();
  });
});
