import { describe, expect, it } from 'vitest';
import { projectSlots, projectBlocks, type RosterRow, type BlockRow } from './projection';
import type { ScheduleSlot } from '@/features/timetable/server/queries';
const slot = (day: string): ScheduleSlot => ({ id: day, classId: 'c1', className: 'English', subject: 'english', dayOfWeek: day,
  startTime: '18:00:00', endTime: '19:00:00', teacherName: 'Kim', slotTeacherLabel: 'Jane', classroomName: '201',
  slotRoomLabel: null, slotRoomId: null, classRoomId: 'r1', studentCount: 0, classBgColor: null, classTextColor: null,
  pendingHandover: null, isSpecialLecture: false, englishTrack: null });
const row = (overrides: Partial<RosterRow> = {}): RosterRow => ({ id: 'e1', class_id: 'c1', student_id: 's1', start_date: '2026-09-28',
  end_date: null, on_hold: false, is_transferred: false, attendance_days: [], student: { name: 'Student', status: 'active', withdrawn_at: null }, ...overrides });
describe('read-only timetable projection', () => {
  it('checks enrollment dates on each weekday, not just Monday; transfer end is exclusive', () => {
    const result = projectSlots([slot('mon'), slot('wed'), slot('thu')], [row({ start_date: '2026-09-30', end_date: '2026-10-01', is_transferred: true })], [], '2026-09-28');
    expect(result.map(s => s.students.length)).toEqual([0, 1, 0]);
    const inclusive = projectSlots([slot('thu')], [row({ end_date: '2026-10-01' })], [], '2026-09-28');
    expect(inclusive[0].students).toHaveLength(1);
  });
  it('keeps split attendance and excludes hold/withdrawn students without exposing unrelated fields', () => {
    const roster = [row({ attendance_days: ['thu'] }), row({ id: 'e2', student_id: 's2', on_hold: true }),
      row({ id: 'e3', student_id: 's3', student: { name: 'Ended', status: 'withdrawn', withdrawn_at: '2026-09-28' } })];
    const result = projectSlots([slot('mon'), slot('thu')], roster, [], '2026-09-28');
    expect(result[0].students).toEqual([]); expect(result[1].students).toEqual([{ id: 's1', name: 'Student', enrollmentId: 'e1', attendanceDays: ['thu'] }]);
  });
  it('does not attach the homeroom teacher ID to an overridden slot teacher or guess duplicate names', () => {
    const result = projectSlots([slot('mon')], [], [{ id: 'home', display_name: 'Kim' }, { id: 'slot', display_name: 'Jane' }], '2026-09-28');
    expect(result[0].teacherId).toBe('slot');
    expect(projectSlots([slot('mon')], [], [{ id: 'a', display_name: 'Jane' }, { id: 'b', display_name: 'Jane' }], '2026-09-28')[0].teacherId).toBeNull();
    expect(projectSlots([{ ...slot('mon'), slotTeacherLabel: 'LAB' }], [], [{ id: 'bad', display_name: 'LAB' }], '2026-09-28')[0]).toMatchObject({ kind: 'seat', teacherId: null });
  });
  it('does not silently omit missing student references', () => {
    expect(() => projectSlots([slot('mon')], [row({ student: null })], [], '2026-09-28')).toThrow('Missing student');
  });
  it('includes blocks beginning midweek and excludes a replaced block on its actual day', () => {
    const block: BlockRow = { id: 'b', teacher_label: 'J', day_of_week: 'thu', start_time: '18:00', end_time: '19:00', label: 'Meeting', valid_from: '2026-09-30', valid_to: null };
    const result = projectBlocks([block, { ...block, id: 'old', valid_from: null, valid_to: '2026-09-30' }], '2026-09-28', { J: 'Jane' }, [{ id: 't', display_name: 'Jane' }]);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id: 'block:b', teacher: 'Jane', teacherId: 't', kind: 'block' });
  });
});
