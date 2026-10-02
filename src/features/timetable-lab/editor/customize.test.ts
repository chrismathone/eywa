import { describe, expect, it } from 'vitest';
import { moveBlocks, removeBlocks } from './block-commands';
import { suggest } from './constraints';
import { reasonOf } from './reason';
import { classList, mergeClasses, moveClassStudent, splitClass } from './class-commands';
import { freeBands, laneKey } from './free-slots';
import { draftStats, hoursLabel, previewMove } from './insights';
import { addBlock, addClass, addLesson, deleteClass, duplicateToDays, renameBlock, replaceRoom, setHomeroom, setLocked, setNote, setRoom, shiftBlocks, swapBlocks } from './item-commands';
import { lessons, type Draft } from './model';
import { makeNativeFixture } from './native-fixture';
import { resizeLesson } from './operating-times';
import { addStudentToClass, createStudent, removeStudentFromClass, renameStudent, setStudentLessons, studentSchedule } from './roster-commands';
import { DraftStore } from './store';
import { addTeacher, moveTeacher, reassignTeacher, removeTeacher, renameTeacher, swapTeachers, teacherColumns } from './teachers';
import { teacherLayout } from './teacher-layout';
import { draftSnapshotSchema } from '@/features/timetable-lab/draft-schema';

// 예제: 영어 A(월 18~19, 강사 가, 201, s1) · 영어 B(화 18~19, 강사 나, 202, s2) · 영어 C(목 19~20, 강사 가, 201, s3)
const base = () => makeNativeFixture();
const at = (day: string, teacher: string, start: number, end: number, room = '') => ({ day, teacher, start, end, room });
const byName = (draft: Draft, name: string) => lessons(draft).items.filter(p => p.name === name);
const only = (draft: Draft, id: string) => lessons(draft).items.find(p => p.id === id)!;

describe('새 항목 추가', () => {
  it('기존 반에 수업을 더하면 그 반 학생 전원이 배정되고, 한 번에 되돌려진다', () => {
    const store = new DraftStore(base()), before = store.getSnapshot().draft;
    store.commit('수업 추가', addLesson(before, 'class-1', at('수', '강사 나', 1080, 1140, '203')));
    const added = byName(store.getSnapshot().draft, '영어 A').find(p => p.day === '수')!;
    expect(added).toMatchObject({ teacher: '강사 나', room: '203', start: 1080, end: 1140, students: ['s1'], sourceScheduleId: null });
    expect(before.placements).toHaveLength(3);
    store.undo(); expect(store.getSnapshot().draft).toEqual(before);
  });
  it('새 반은 이름이 겹치면 거절하고, 만들면 학생 없이 두 뷰에 나타난다', () => {
    const draft = base();
    expect(() => addClass(draft, '영어 A', at('금', '강사 가', 1080, 1140))).toThrow('이미 있는 반');
    const next = addClass(draft, '영어 신규', at('금', '강사 가', 1080, 1140, '204'));
    const created = classList(next).find(c => c.name === '영어 신규')!;
    expect(created.students).toEqual([]); expect(created.items).toHaveLength(1);
    expect(next.classes?.[created.id]).toMatchObject({ name: '영어 신규', homeroomTeacher: '강사 가' });
    expect(classList(draft)).toHaveLength(3);
  });
  it('묶음에 든 반만 보이는 통합뷰 설정이면 새 반을 마지막 묶음에 넣어 숨지 않게 한다', () => {
    const draft = base();
    draft.appearance!.groups = { groups: [{ id: 'g', title: '영어', classIds: ['class-1', 'class-2', 'class-3'] }], showOthers: false, othersTitle: '기타' };
    const next = addClass(draft, '영어 신규', at('금', '강사 가', 1080, 1140));
    expect(next.appearance?.groups?.groups[0].classIds).toHaveLength(4);
  });
  it('수업은 운영시간 안에서만, 회의는 운영시간 밖에도 놓인다', () => {
    const draft = base();
    expect(() => addLesson(draft, 'class-1', at('수', '강사 가', 540, 600))).toThrow('운영시간');
    const next = addBlock(draft, '강사 회의', at('수', '강사 가', 540, 600));
    expect(byName(next, '강사 회의')[0]).toMatchObject({ kind: 'block', classId: '', start: 540, end: 600 });
    expect(renameBlock(next, byName(next, '강사 회의')[0].id, '주간 회의').cells.at(-1)![0].text).toBe('주간 회의');
    expect(() => addBlock(draft, ' ', at('수', '강사 가', 540, 600))).toThrow();
    expect(() => addLesson(draft, 'class-1', at('수', '없는 강사', 1080, 1140))).toThrow('강사');
  });
});

describe('수업·반 고치기', () => {
  it('강의실을 한 수업·여러 수업·전체 찾아 바꾸기로 바꾼다', () => {
    const draft = base();
    expect(only(setRoom(draft, ['placement-1'], '305'), 'placement-1').room).toBe('305');
    const replaced = replaceRoom(draft, '201', '301');
    expect(lessons(replaced).items.map(p => p.room)).toEqual(['301', '202', '301']);
    expect(() => replaceRoom(draft, '999', '301')).toThrow('쓰는 수업이 없습니다');
    expect(setRoom(draft, ['placement-1'], '201')).toBe(draft);
  });
  it('다른 요일로 복사하면 같은 시간·강사·학생의 새 수업이 생긴다', () => {
    const next = duplicateToDays(base(), ['placement-1'], ['월', '수', '금']);
    const copies = byName(next, '영어 A');
    expect(copies.map(p => p.day).sort()).toEqual(['금', '수', '월']);
    expect(copies.every(p => p.students.includes('s1') && p.start === 1080 && p.teacher === '강사 가')).toBe(true);
    expect(() => duplicateToDays(base(), ['placement-1'], ['월'])).toThrow('이미 그 요일');
  });
  it('여러 수업을 같은 분만큼 밀고, 두 수업의 자리를 맞바꾼다', () => {
    const shifted = shiftBlocks(base(), ['placement-1', 'placement-2'], 30);
    expect([only(shifted, 'placement-1').start, only(shifted, 'placement-2').start]).toEqual([1110, 1110]);
    expect(only(shifted, 'placement-2').teacher).toBe('강사 나');
    const swapped = swapBlocks(base(), 'placement-1', 'placement-3');
    expect(only(swapped, 'placement-1')).toMatchObject({ day: '목', start: 1140, end: 1200, room: '201' });
    expect(only(swapped, 'placement-3')).toMatchObject({ day: '월', start: 1080, end: 1140 });
  });
  it('담임을 바꾸고, 반을 지우면 수업·명단이 함께 사라지되 다른 반은 그대로다', () => {
    const draft = base();
    expect(setHomeroom(draft, 'class-1', '강사 나').classes?.['class-1'].homeroomTeacher).toBe('강사 나');
    expect(() => setHomeroom(draft, 'class-1', '없는 강사')).toThrow();
    const next = deleteClass(draft, 'class-1');
    expect(classList(next).map(c => c.id)).toEqual(['class-2', 'class-3']);
    expect(next.students['class-1']).toBeUndefined(); expect(next.students['class-2']).toEqual(['s2']);
  });
  it('잠근 수업은 옮기기·길이 변경·지우기·반 지우기·합치기를 모두 거절하고, 풀면 다시 된다', () => {
    const locked = setLocked(base(), ['placement-1'], true);
    const to = { day: '수', teacher: '강사 가', start: 1080 };
    for (const run of [() => moveBlocks(locked, ['placement-1'], 'placement-1', to), () => removeBlocks(locked, ['placement-1']),
      () => resizeLesson(locked, 'placement-1', 1080, 1120), () => deleteClass(locked, 'class-1'), () => mergeClasses(locked, 'class-1', 'class-2'),
      () => setRoom(locked, ['placement-1'], '305'), () => reassignTeacher(locked, '강사 가', '강사 나')]) expect(run).toThrow('잠근 수업');
    const unlocked = setLocked(locked, ['placement-1'], false);
    expect(only(moveBlocks(unlocked, ['placement-1'], 'placement-1', to), 'placement-1').day).toBe('수');
    expect(setNote(base(), 'placement-1', ' 교재 확인 ').placements[0].note).toBe('교재 확인');
  });
});

describe('강사 열', () => {
  it('새 강사는 수업이 없어도 열이 생기고 평일 칸이 보이며, 그 칸으로 수업을 옮길 수 있다', () => {
    const next = addTeacher(base(), '신규 강사');
    expect(teacherColumns(next)).toEqual(['강사 가', '강사 나', '신규 강사']);
    const lanes = teacherLayout(next, lessons(next).items, 1).lanes.filter(l => l.teacher === '신규 강사');
    expect(lanes.map(l => l.day)).toEqual(['월', '화', '수', '목', '금']);
    const moved = moveBlocks(next, ['placement-1'], 'placement-1', { day: '월', teacher: '신규 강사', start: 1080 });
    expect(only(moved, 'placement-1')).toMatchObject({ teacher: '신규 강사', teacherId: null });
    expect(() => addTeacher(next, '신규 강사')).toThrow('이미');
  });
  it('이름을 바꾸면 수업·색·담임이 따라가고, 순서를 바꿀 수 있다', () => {
    const draft = setHomeroom(base(), 'class-1', '강사 가');
    const next = renameTeacher(draft, '강사 가', '김선생');
    expect(byName(next, '영어 A')[0].teacher).toBe('김선생');
    expect(next.appearance?.teacherColors['김선생']).toEqual({ bg: '#f6b26b', text: '#121212' });
    expect(next.appearance?.teacherColors['강사 가']).toBeUndefined();
    expect(next.classes?.['class-1'].homeroomTeacher).toBe('김선생');
    expect(teacherColumns(moveTeacher(next, '김선생', 1))).toEqual(['강사 나', '김선생']);
    expect(() => renameTeacher(draft, '강사 가', '강사 나')).toThrow('이미');
  });
  it('수업을 모두 넘기거나 맞바꾸고, 수업이 남은 열은 지우지 않는다', () => {
    const draft = base();
    expect(() => removeTeacher(draft, '강사 가')).toThrow('2개가 남아');
    const handed = reassignTeacher(draft, '강사 가', '강사 나');
    expect(lessons(handed).items.every(p => p.teacher === '강사 나')).toBe(true);
    expect(teacherColumns(removeTeacher(handed, '강사 가'))).toEqual(['강사 나']);
    const swapped = swapTeachers(draft, '강사 가', '강사 나');
    expect(lessons(swapped).items.map(p => p.teacher)).toEqual(['강사 나', '강사 가', '강사 나']);
  });
});

describe('학생', () => {
  it('새 학생을 만들어 두 반에 함께 넣고, 한 반에서만 뺀다', () => {
    const made = createStudent(base(), '신입 학생');
    expect(made.id.startsWith('new:')).toBe(true);
    const both = addStudentToClass(addStudentToClass(made.draft, made.id, 'class-1'), made.id, 'class-2');
    expect(studentSchedule(both, made.id).map(c => c.classId)).toEqual(['class-1', 'class-2']);
    expect(classList(both).find(c => c.id === 'class-1')!.students).toEqual(['s1', made.id]);
    const one = removeStudentFromClass(both, made.id, 'class-1');
    expect(studentSchedule(one, made.id).map(c => c.classId)).toEqual(['class-2']);
    expect(() => addStudentToClass(both, made.id, 'class-1')).toThrow('이미');
    expect(renameStudent(both, made.id, '이름 변경').people?.[made.id]).toBe('이름 변경');
    expect(renameStudent(base(), 's1', '학생 가 수정').people?.s2).toBe('학생 나');
  });
  it('수업별로 오는 요일을 정하고, 하나도 안 고르면 반에서 빠진다', () => {
    const draft = duplicateToDays(base(), ['placement-1'], ['수']);
    const [mon, wed] = byName(draft, '영어 A').sort((a, b) => a.day.localeCompare(b.day)).reverse();
    const monOnly = setStudentLessons(draft, 's1', 'class-1', [byName(draft, '영어 A').find(p => p.day === '월')!.id]);
    expect(byName(monOnly, '영어 A').map(p => [p.day, p.students]).sort()).toEqual([['수', []], ['월', ['s1']]]);
    expect(classList(setStudentLessons(draft, 's1', 'class-1', [])).find(c => c.id === 'class-1')!.students).toEqual([]);
    expect(setStudentLessons(draft, 's1', 'class-1', [mon.id, wed.id])).toBe(draft);
    expect(() => setStudentLessons(draft, 's1', 'class-1', ['placement-2'])).toThrow('이 반의 수업만');
  });
});

describe('저장', () => {
  it('🔴 편집기가 만든 모든 종류의 변경이 서버의 저장 검증(모르는 키 거절)을 통과한다', () => {
    let draft = addTeacher(base(), '신규 강사');
    draft = addClass(draft, '영어 신규', at('금', '신규 강사', 1080, 1140, '204'));
    draft = addBlock(draft, '강사 회의', at('수', '강사 가', 540, 600));
    draft = addLesson(draft, 'class-1', at('수', '강사 나', 1080, 1140));
    const made = createStudent(draft, '신입 학생');
    draft = addStudentToClass(made.draft, made.id, 'class-2');
    draft = setNote(setLocked(draft, ['placement-1'], true), 'placement-1', '교재 확인');
    draft = setLocked(draft, ['placement-1'], false);
    draft = moveTeacher(renameTeacher(draft, '강사 나', '박선생'), '박선생', -1);
    const sent = JSON.parse(JSON.stringify(draft));
    const parsed = draftSnapshotSchema.safeParse(sent);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(lessons(parsed.data as Draft).items).toHaveLength(6);
    expect((parsed.data as Draft).teachers).toEqual(['박선생', '강사 가', '신규 강사']);
  });
});

describe('놓기 전 미리 보기와 요약', () => {
  it('같은 강사·같은 시간으로 옮기면 새로 생기는 겹침을 알려 주고, 운영시간 밖은 놓을 수 없다고 말한다', () => {
    const draft = base();
    const clash = previewMove(draft, ['placement-3'], 'placement-3', { day: '월', teacher: '강사 가', start: 1080 });
    expect(clash).toMatchObject({ ok: true, added: 1 }); expect(clash.reason).toContain('겹침');
    expect(previewMove(draft, ['placement-3'], 'placement-3', { day: '수', teacher: '강사 가', start: 1080 })).toMatchObject({ ok: true, added: 0 });
    expect(previewMove(draft, ['placement-3'], 'placement-3', { day: '수', teacher: '강사 가', start: 300 }).ok).toBe(false);
    expect(lessons(draft).items).toHaveLength(3);
  });
  it('강사별 시수·강의실 사용·반 인원을 센다', () => {
    const stats = draftStats(base());
    expect(stats.teachers.find(t => t.name === '강사 가')).toMatchObject({ lessons: 2, minutes: 120, days: 2 });
    expect(stats.rooms).toEqual([{ room: '201', lessons: 2, minutes: 120 }, { room: '202', lessons: 1, minutes: 60 }]);
    expect(stats.classes.map(c => c.students)).toEqual([1, 1, 1]);
    expect(stats.students).toMatchObject({ total: 3, multi: 0 });
    expect([hoursLabel(90), hoursLabel(120), hoursLabel(40)]).toEqual(['1시간 30분', '2시간', '40분']);
  });
});

describe('겹침 없이 놓을 수 있는 자리', () => {
  const lanes = ['월', '화', '목'].flatMap(day => ['강사 가', '강사 나'].map(teacher => ({ teacher, day })));
  it('강사·강의실·학생이 겹치는 시간을 피하고, 실제로 그 자리에 놓으면 새 겹침이 없다', () => {
    const draft = base(), bands = freeBands(draft, 'placement-3', lanes);
    // 영어 C(강사 가·201호·60분)를 월요일 강사 가 칸에 놓으면 18~19시의 영어 A와 강사·강의실이 겹친다.
    const monday = bands.get(laneKey('강사 가', '월'))!;
    expect(monday.some(b => b.start < 1140 && b.end > 1080)).toBe(false);
    expect(monday.some(b => b.end === 1080)).toBe(true); expect(monday.some(b => b.start === 1140)).toBe(true);
    // 강사 나 칸이어도 같은 201호라 월 18~19시는 비지 않는다(강의실 겹침).
    expect(bands.get(laneKey('강사 나', '월'))!.some(b => b.start < 1140 && b.end > 1080)).toBe(false);
    for (const [key, list] of bands) for (const band of list) {
      const [teacher, day] = key.split('|');
      for (const start of [band.start, band.end - 60]) expect(previewMove(draft, ['placement-3'], 'placement-3', { teacher, day, start })).toMatchObject({ ok: true, added: 0 });
    }
  });
  it('학생이 다른 수업에 있는 시간도 비지 않은 자리로 본다', () => {
    const draft = addStudentToClass(base(), 's3', 'class-2'); // 학생 다: 영어 C + 영어 B(화 18~19)
    expect(freeBands(draft, 'placement-3', lanes).get(laneKey('강사 가', '화'))!.some(b => b.start < 1140 && b.end > 1080)).toBe(false);
    expect(freeBands(base(), 'placement-3', lanes).get(laneKey('강사 가', '화'))!.some(b => b.start <= 1080 && b.end >= 1140)).toBe(true);
  });
  it('잠근 수업은 옮길 수 없으므로 자리를 칠하지 않는다', () => {
    expect(freeBands(setLocked(base(), ['placement-3'], true), 'placement-3', lanes).size).toBe(0);
  });
});

describe('검토에서 잡은 것(2026-10-03)', () => {
  it('🔴 잠근 수업은 ‘겹치지 않는 시간 찾기’로도 옮겨지지 않는다 — 추천을 내지 않는다', () => {
    const draft = base();
    expect(suggest(draft, 'placement-1', 0).length).toBeGreaterThan(0);
    expect(suggest(setLocked(draft, ['placement-1'], true), 'placement-1', 0)).toEqual([]);
  });
  it('수업이 모두 떠난 강사 열은 저절로 사라지지 않는다 — 두 수업 자리 맞바꾸기는 고른 순서와 무관하다', () => {
    const draft = base(); // 강사 나의 수업은 영어 B 하나뿐
    const moved = moveBlocks(draft, ['placement-2'], 'placement-2', { day: '수', teacher: '강사 가', start: 1080 });
    expect(teacherColumns(moved)).toEqual(['강사 가', '강사 나']);
    expect(teacherLayout(moved, lessons(moved).items, 1).lanes.some(l => l.teacher === '강사 나')).toBe(true);
    for (const [a, b] of [['placement-1', 'placement-2'], ['placement-2', 'placement-1']]) {
      const swapped = swapBlocks(draft, a, b);
      expect(only(swapped, 'placement-1')).toMatchObject({ day: '화', teacher: '강사 나' });
      expect(only(swapped, 'placement-2')).toMatchObject({ day: '월', teacher: '강사 가' });
    }
    // 반을 지우거나 수업을 지워도 열은 남는다. 열을 없애는 길은 ‘이 열 지우기’뿐이다.
    expect(teacherColumns(deleteClass(draft, 'class-2'))).toEqual(['강사 가', '강사 나']);
    expect(teacherColumns(removeBlocks(draft, ['placement-2']))).toEqual(['강사 가', '강사 나']);
    expect(teacherColumns(mergeClasses(draft, 'class-2', 'class-1'))).toEqual(['강사 가', '강사 나']);
    // 열이 줄지 않는 이동은 순서를 굳히지 않는다(연습본을 쓸데없이 바꾸지 않는다).
    expect(moveBlocks(draft, ['placement-1'], 'placement-1', { day: '수', teacher: '강사 가', start: 1080 }).teachers).toBeUndefined();
  });
  it('강사 열을 지우면 그 이름을 가리키던 담임·색·별명도 함께 거둔다', () => {
    let draft = setHomeroom(addTeacher(base(), '빈 강사'), 'class-1', '빈 강사');
    draft = structuredClone(draft); draft.appearance!.teacherColors['빈 강사'] = { bg: '#ffffff', text: '#000000' }; draft.appearance!.teacherNicknames['빈 강사'] = '별명';
    const next = removeTeacher(draft, '빈 강사');
    expect(next.classes?.['class-1'].homeroomTeacher).toBeUndefined();
    expect(next.appearance!.teacherColors['빈 강사']).toBeUndefined(); expect(next.appearance!.teacherNicknames['빈 강사']).toBeUndefined();
    expect(draftSnapshotSchema.safeParse(JSON.parse(JSON.stringify(next))).success).toBe(true);
  });
  it('강사 이름을 바꾸면 시간이 덜 정해진 수업의 줄도 함께 바뀐다 · 자습·LAB 열의 이름은 바꿀 수 없다', () => {
    const draft = structuredClone(base()); draft.cells[1][2].text = ''; // 영어 A의 시작 시간이 비었다 → 화면에 안 나오는 미확정 수업
    expect(lessons(draft).items.some(p => p.id === 'placement-1')).toBe(false);
    const renamed = renameTeacher(draft, '강사 가', '김선생');
    expect(renamed.cells[1][4].text).toBe('김선생');
    const seat = structuredClone(base()); seat.placements[1].kind = 'seat'; // 강사 나 열이 자리 열이 된다
    expect(() => renameTeacher(seat, '강사 나', '자습실')).toThrow('바꿀 수 없습니다');
  });
  it('고른 수업에만 학생을 넣으면 그 반의 다른 수업에는 들어가지 않는다', () => {
    const two = addLesson(base(), 'class-1', at('수', '강사 가', 1080, 1140, '201'));
    const wed = byName(two, '영어 A').find(p => p.day === '수')!;
    const next = addStudentToClass(two, 's2', 'class-1', [wed.id]);
    expect(only(next, wed.id).students).toEqual(['s1', 's2']);
    expect(only(next, 'placement-1').students).toEqual(['s1']);
  });
  it('🔴 반 나누기·합치기·학생 이동·강사 맞바꾸기·복제·담임 비우기를 한 연습본도 저장 검증을 통과한다', () => {
    let draft = addStudentToClass(base(), 's2', 'class-1');
    draft = splitClass(draft, 'class-1', '영어 A 새 반', ['s2']);
    draft = moveClassStudent(draft, 's3', 'class-3', 'class-2');
    draft = mergeClasses(draft, 'class-3', 'class-2');
    draft = swapTeachers(draft, '강사 가', '강사 나');
    draft = duplicateToDays(draft, ['placement-2'], ['금']);
    draft = setHomeroom(setHomeroom(draft, 'class-2', '강사 가'), 'class-2', '');
    draft = setRoom(draft, ['placement-2'], '');
    const parsed = draftSnapshotSchema.safeParse(JSON.parse(JSON.stringify(draft)));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(Object.keys((parsed.data as Draft).studentMoves ?? {}).length).toBeGreaterThan(0);
  });
  it('화면에 보이는 실패 이유는 명령이 던진 한국어 문장만 — 영문 오류 원문은 준비한 안내로 바꾼다', () => {
    expect(reasonOf(new Error('잠근 수업이 있습니다.'), '안내')).toBe('잠근 수업이 있습니다.');
    expect(reasonOf(new TypeError('Failed to fetch'), '연결을 확인해 주세요.')).toBe('연결을 확인해 주세요.');
    expect(reasonOf('문자열', '안내')).toBe('안내');
  });
});
