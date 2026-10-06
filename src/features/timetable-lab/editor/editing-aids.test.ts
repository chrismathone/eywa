import { describe, expect, it } from 'vitest';
import { conflictNotes } from './insights';
import { conflictLines } from './lesson-block';
import { lessons, type Draft } from './model';
import { makeNativeFixture } from './native-fixture';
import { findStudents } from './student-picker';
import { addTeacher, placeTeacher, teacherColumns } from './teachers';
import { teacherLayout } from './teacher-layout';
import { draftSnapshotSchema } from '@/features/timetable-lab/draft-schema';

// 예제: 영어 A(월 18~19, 강사 가, 201, s1) · 영어 B(화 18~19, 강사 나, 202, s2) · 영어 C(목 19~20, 강사 가, 201, s3)
// 다른 과목: 수학 샘플(월 18~19, 수학 강사, 301, s1)
const base = () => makeNativeFixture();
const daysOf = (draft: Draft, teacher: string) => teacherLayout(draft, lessons(draft).items, 1).lanes.filter(l => l.teacher === teacher).map(l => l.day);
const look = (draft: Draft, patch: Partial<NonNullable<Draft['appearance']>>): Draft => ({ ...draft, appearance: { ...draft.appearance!, ...patch } });
/** 표의 한 줄(수업)의 요일·시작·종료를 바꾼다 — 운영시간 판정을 거치지 않고 모양만 만든다. */
function retime(draft: Draft, row: number, day: string, start: string, end: string): Draft {
  const next = structuredClone(draft);
  next.cells[row][1].text = day; next.cells[row][2].text = start; next.cells[row][3].text = end;
  return next;
}

describe('강사 열 통째로 옮기기', () => {
  const four = () => addTeacher(addTeacher(base(), '강사 다'), '강사 라');
  it('고른 열 앞으로, 또는 맨 뒤로 간다 — 수업은 그대로다', () => {
    const draft = four();
    expect(teacherColumns(draft)).toEqual(['강사 가', '강사 나', '강사 다', '강사 라']);
    expect(teacherColumns(placeTeacher(draft, '강사 라', '강사 가'))).toEqual(['강사 라', '강사 가', '강사 나', '강사 다']);
    expect(teacherColumns(placeTeacher(draft, '강사 가', '강사 다'))).toEqual(['강사 나', '강사 가', '강사 다', '강사 라']);
    const last = placeTeacher(draft, '강사 가', null);
    expect(teacherColumns(last)).toEqual(['강사 나', '강사 다', '강사 라', '강사 가']);
    expect(lessons(last).items).toEqual(lessons(draft).items);
  });
  it('제자리에 놓으면 연습본을 건드리지 않는다(되돌리기 기록이 늘지 않는다)', () => {
    const draft = four(), fresh = base();
    expect(placeTeacher(draft, '강사 나', '강사 나')).toBe(draft);
    expect(placeTeacher(draft, '강사 나', '강사 다')).toBe(draft);
    expect(placeTeacher(draft, '강사 라', null)).toBe(draft);
    // 순서를 한 번도 굳힌 적 없는 연습본도 마찬가지다.
    expect(placeTeacher(fresh, '강사 가', '강사 나')).toBe(fresh);
  });
  it('없는 열은 거절한다', () => {
    expect(() => placeTeacher(four(), '없는 강사', null)).toThrow('다시 선택');
    expect(() => placeTeacher(four(), '강사 가', '없는 강사')).toThrow('다시 선택');
  });
});

describe('강사뷰의 주말 칸', () => {
  it('토요일은 기본으로 보이고 숨길 수 있다 · 일요일은 기본으로 접혀 있고 펼 수 있다', () => {
    const draft = base();
    expect(daysOf(draft, '강사 가')).toEqual(['월', '화', '수', '목', '금', '토']);
    expect(daysOf(look(draft, { hideSaturday: true }), '강사 가')).toEqual(['월', '화', '수', '목', '금']);
    expect(daysOf(look(draft, { showSunday: true }), '강사 가')).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(daysOf(look(draft, { hideSaturday: true, showSunday: true }), '강사 가')).toEqual(['월', '화', '수', '목', '금', '일']);
  });
  it('🔴 수업이 있는 주말 칸은 숨겨도 보인다 — 그 강사 열에만', () => {
    const saturday = look(retime(base(), 1, '토', '10:00', '11:00'), { hideSaturday: true });
    expect(daysOf(saturday, '강사 가')).toEqual(['월', '화', '수', '목', '금', '토']);
    expect(daysOf(saturday, '강사 나')).toEqual(['월', '화', '수', '목', '금']);
    expect(daysOf(retime(base(), 1, '일', '10:00', '11:00'), '강사 가')).toContain('일');
  });
  it('‘빈 요일 접기’가 켜져 있으면 주말 설정과 무관하게 수업이 있는 요일만 남는다 · 새 강사 열은 평일만', () => {
    expect(daysOf(look(base(), { hideEmptyDays: true, showSunday: true }), '강사 가')).toEqual(['월', '목']);
    expect(daysOf(look(addTeacher(base(), '신규 강사'), { showSunday: true }), '신규 강사')).toEqual(['월', '화', '수', '목', '금']);
  });
  it('주말 설정이 든 연습본도, 없는 옛 연습본도 저장 검사를 통과한다', () => {
    const plain = JSON.parse(JSON.stringify(base()));
    expect(draftSnapshotSchema.safeParse(plain).success).toBe(true);
    expect(draftSnapshotSchema.safeParse(JSON.parse(JSON.stringify(look(base(), { hideSaturday: true, showSunday: true })))).success).toBe(true);
  });
});

describe('겹치는 이유', () => {
  it('상대 수업·시간·겹친 축을 적고, 학생이 겹치면 누구인지도 적는다', () => {
    const notes = conflictNotes(base());
    expect(notes.get('placement-1')).toEqual(['수학 샘플(수학 강사 · 301) · 월 18:00~19:00 · 학생 겹침 (학생 가)']);
    expect(notes.has('placement-2')).toBe(false);
  });
  it('두 수업이 서로를 가리킨다 — 강사와 강의실이 함께 겹치면 둘 다 적는다', () => {
    const notes = conflictNotes(retime(base(), 3, '월', '18:30', '19:30'));
    expect(notes.get('placement-3')).toEqual(['영어 A(강사 가 · 201) · 월 18:30~19:00 · 강사·강의실 겹침']);
    expect(notes.get('placement-1')).toEqual(['영어 C(강사 가 · 201) · 월 18:30~19:00 · 강사·강의실 겹침', '수학 샘플(수학 강사 · 301) · 월 18:00~19:00 · 학생 겹침 (학생 가)']);
  });
  it('수업 칸의 설명 뒤에 한 줄씩 붙는다 — 겹침이 없으면 아무것도 붙지 않는다', () => {
    expect(conflictLines(['가', '나'])).toBe('\n겹침: 가\n겹침: 나');
    expect(conflictLines(undefined)).toBe('');
    expect(conflictLines([])).toBe('');
  });
});

describe('반에 넣을 학생 찾기', () => {
  const people = { a: '김나윤A', b: '김나윤B', c: '이나윤', d: '박 서준', e: '김태린', f: '나은' };
  it('이름의 어느 부분으로도 찾는다 — 입력으로 시작하는 이름이 먼저, 그다음 가나다순', () => {
    expect(findStudents(people, [], '나윤')).toEqual(['a', 'b', 'c']);
    expect(findStudents(people, [], '나')).toEqual(['f', 'a', 'b', 'c']);
    expect(findStudents(people, [], '박서')).toEqual(['d']);
  });
  it('이미 이 반에 있는 학생은 빼고, 빈 입력에는 아무도 내지 않는다', () => {
    expect(findStudents(people, ['a'], '김')).toEqual(['b', 'e']);
    expect(findStudents(people, [], '  ')).toEqual([]);
    expect(findStudents(people, [], '없는이름')).toEqual([]);
  });
});
