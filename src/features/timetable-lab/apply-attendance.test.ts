import { describe, expect, it } from 'vitest';
import { planLabAttendance, slotChangedClasses } from './apply-attendance';
import { timeMinutes } from './editor/model';
import type { ApplyPlan } from './apply-plan';
import type { ApplyContext, NativeEnrollment, NativeSchedule } from './server/apply-context';
import type { AttendanceLink, MasterAttendance } from '@/features/timetable/import/master/attendance-types';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-11-02'; // 월요일
const A = uid(1), B = uid(2), student = uid(50), teacher = uid(60);
const lesson = (id: number, classId: string, start: string, over: Partial<NativeSchedule> = {}): NativeSchedule => ({ id: uid(id), classId, day: 'mon', start, end: `${start.slice(0, 2)}:59`, teacherId: teacher, roomId: null, teacherLabel: null, roomLabel: null, validFrom: '2026-01-01', validTo: null, labSeparate: false, mergeGroup: null, periodLabel: null, ...over } as NativeSchedule);
const enrollment = (id: number, classId: string): NativeEnrollment => ({ id: uid(id), studentId: student, classId, start: '2026-01-01', end: null, hold: false, transferred: false, days: null, salaryTier: null });
const context = (schedules: NativeSchedule[], enrollments = [enrollment(70, A)]) => ({ classes: [{ id: A, name: '반 A' }, { id: B, name: '반 B' }], schedules, enrollments, students: [{ id: student, name: '학생' }], people: [], rooms: [] } as unknown as ApplyContext);
const changed = (before: NativeSchedule, start: string, over: { day?: string; classId?: string; teacher?: string; label?: string | null } = {}) => ({ before, day: over.day ?? before.day, teacherId: teacher, teacherLabel: over.label ?? null, item: { classId: over.classId ?? before.classId, start: timeMinutes(start)!, end: timeMinutes(start)! + 50, teacher: over.teacher ?? '강사' } });
const plan = (over: Partial<Record<keyof ApplyPlan, unknown>>) => ({ schedules: [], removedSchedules: [], closedClasses: [], classes: [], enrollments: [], ...over } as unknown as ApplyPlan);
const cell = (id: number, classId: string, start: string | null, record: Record<string, unknown> = {}, on = date): MasterAttendance => ({ id: uid(id), classId, studentId: student, date: on, startTime: start, record: { id: uid(id), status: 'present', ...record } });
const link = (classId: string, kind: string): AttendanceLink => ({ classId, studentId: student, date, kind });

describe('연습본 적용의 출결 이관', () => {
  it('강사·강의실만 바뀐 수업의 출결은 그대로 둔다', () => {
    const old = lesson(10, A, '16:20'), result = planLabAttendance(plan({ schedules: [changed(old, '16:20')] }), context([old]), date, [cell(80, A, '16:20')], []);
    expect(result).toEqual({ moves: [], errors: [] });
    expect(slotChangedClasses(plan({ schedules: [changed(old, '16:20')] })).size).toBe(0);
  });
  it('시각이 바뀌면 같은 강사 교시가 둘이어도 그 수업이 간 교시로 옮긴다', () => {
    const moving = lesson(10, A, '16:20'), staying = lesson(11, A, '18:20');
    const result = planLabAttendance(plan({ schedules: [changed(moving, '19:20')] }), context([moving, staying]), date, [cell(80, A, '16:20')], []);
    expect(result.errors).toEqual([]);
    expect(result.moves).toEqual([expect.objectContaining({ ids: [uid(80)], fromTime: '16:20', toClassId: A, toTime: '19:20' })]);
  });
  it('한 교시씩 밀리는 시간표는 비켜나는 칸을 충돌로 보지 않는다', () => {
    const first = lesson(10, A, '16:20'), second = lesson(11, A, '17:20');
    const result = planLabAttendance(plan({ schedules: [changed(first, '17:20'), changed(second, '18:20')] }), context([first, second]), date, [cell(80, A, '16:20'), cell(81, A, '17:20')], []);
    expect(result.errors).toEqual([]);
    expect(result.moves.map(move => [move.fromTime, move.toTime]).sort()).toEqual([['16:20', '17:20'], ['17:20', '18:20']]);
  });
  it('학생이 다른 반으로 가면 출결도 그 반 교시로 옮긴다', () => {
    const from = lesson(10, A, '16:20'), to = lesson(11, B, '16:20'), before = enrollment(70, A);
    const enrollments = [{ before, studentId: student, classId: A, days: [], remove: true }, { before: null, studentId: student, classId: B, days: ['mon'], remove: false }];
    const result = planLabAttendance(plan({ enrollments }), context([from, to]), date, [cell(80, A, '16:20')], []);
    expect(result.moves).toEqual([expect.objectContaining({ toClassId: B, toTime: '16:20' })]);
  });
  it('새 교시에 이미 출결이 있으면 합치지 않고 막는다', () => {
    const moving = lesson(10, A, '16:20');
    const result = planLabAttendance(plan({ schedules: [changed(moving, '19:20')] }), context([moving]), date, [cell(80, A, '16:20'), cell(81, A, '19:20')], []);
    expect(result.moves).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('이미 있습니다');
  });
  it('수업보고서는 같은 반의 시각 변경을 막지 않고, 보강 예약은 막는다', () => {
    const old = lesson(10, A, '16:20'), schedules = [changed(old, '19:20')];
    expect(planLabAttendance(plan({ schedules }), context([old]), date, [cell(80, A, '16:20')], [link(A, 'report')]).moves).toHaveLength(1);
    expect(planLabAttendance(plan({ schedules }), context([old]), date, [cell(80, A, '16:20')], [link(A, 'reservation')]).errors[0]).toContain('보강 예약');
  });
  it('반을 옮기는 학생은 수업보고서가 있으면 막는다', () => {
    const from = lesson(10, A, '16:20'), to = lesson(11, B, '16:20'), before = enrollment(70, A);
    const enrollments = [{ before, studentId: student, classId: A, days: [], remove: true }, { before: null, studentId: student, classId: B, days: ['mon'], remove: false }];
    expect(planLabAttendance(plan({ enrollments }), context([from, to]), date, [cell(80, A, '16:20')], [link(A, 'report')]).errors).toHaveLength(1);
  });
  it('보강 출결과 대신 수업한 강사 기록은 옮기지 않고 막는다', () => {
    const old = lesson(10, A, '16:20'), schedules = [changed(old, '19:20')];
    expect(planLabAttendance(plan({ schedules }), context([old]), date, [cell(80, A, '16:20', { status: 'makeup' })], []).errors).toHaveLength(1);
    expect(planLabAttendance(plan({ schedules }), context([old]), date, [cell(80, A, '16:20', { taught_by: teacher })], []).errors).toHaveLength(1);
  });
  it('요일이 바뀌어 그날 수업이 없으면 막는다', () => {
    const old = lesson(10, A, '16:20');
    const result = planLabAttendance(plan({ schedules: [changed(old, '16:20', { day: 'tue' })] }), context([old]), date, [cell(80, A, '16:20')], []);
    expect(result.moves).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
  it('수업이 삭제되고 옮길 교시가 없으면 막는다', () => {
    const old = lesson(10, A, '16:20');
    expect(planLabAttendance(plan({ removedSchedules: [old] }), context([old]), date, [cell(80, A, '16:20')], []).errors).toHaveLength(1);
  });
  it('수강만 끝나는 학생은 적용일 출결을 두고 그 뒤 날짜만 막는다', () => {
    const old = lesson(10, A, '16:20'), before = enrollment(70, A), enrollments = [{ before, studentId: student, classId: A, days: [], remove: true }];
    expect(planLabAttendance(plan({ enrollments }), context([old]), date, [cell(80, A, '16:20')], []).errors).toEqual([]);
    expect(planLabAttendance(plan({ enrollments }), context([old]), date, [cell(80, A, '16:20', {}, '2026-11-09')], []).errors).toHaveLength(1);
  });
  it('등원 요일에서 빠진 뒤 날짜의 출결은 막고, 남는 요일은 둔다', () => {
    const mon = lesson(10, A, '16:20'), tue = lesson(11, A, '16:20', { day: 'tue' }), before = enrollment(70, A), enrollments = [{ before, studentId: student, classId: A, days: ['mon'], remove: false }];
    expect(planLabAttendance(plan({ enrollments }), context([mon, tue]), date, [cell(80, A, '16:20', {}, '2026-11-03')], []).errors).toHaveLength(1);
    expect(planLabAttendance(plan({ enrollments }), context([mon, tue]), date, [cell(80, A, '16:20', {}, '2026-11-09')], []).errors).toEqual([]);
  });
  it('종료할 반에 남는 출결은 막는다', () => {
    const old = lesson(10, A, '16:20'), closedClasses = [{ id: A, name: '반 A' }], removedSchedules = [old];
    expect(planLabAttendance(plan({ closedClasses, removedSchedules }), context([old]), date, [cell(80, A, '16:20')], []).errors.join()).toContain('종료할 반');
  });
  it('LAB에서 일반 수업으로 바뀌면 자리 표시를 함께 옮긴다', () => {
    const old = lesson(10, A, '16:20', { teacherLabel: 'LAB', teacherId: null });
    const result = planLabAttendance(plan({ schedules: [changed(old, '16:20', { label: null, teacher: '강사' })] }), context([old]), date, [cell(80, A, '16:20', { seat_label: 'LAB', recorded_via: 'seat' })], []);
    expect(result.errors).toEqual([]);
    expect(result.moves[0]?.seatChange).toEqual({ from: 'LAB', to: null });
  });
});
