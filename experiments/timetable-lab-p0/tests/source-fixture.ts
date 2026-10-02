import type { LabSource } from '../../../src/features/timetable-lab/types';
export function sourceFixture(): LabSource {
  return { version: 1, subject: 'english', tenantId: 'test-tenant', referenceDate: '2026-09-28', fetchedAt: '2026-10-02T00:00:00Z',
    academy: '검증 학원', stepMinutes: 10, teacherOrder: ['강사 가', '강사 나'], notices: ['합성 시험 자료'],
    slots: Array.from({ length: 5 }, (_, i) => ({ id: `schedule-${i}`, classId: `class-${i}`, name: `영어 ${i + 1}`, subject: 'english',
      day: ['mon', 'mon', 'thu', 'sat', 'sun'][i], start: '18:00', end: '19:00', teacher: i % 2 ? '강사 나' : '강사 가', teacherId: i % 2 ? 't2' : 't1',
      room: i === 4 ? '' : `${201 + i}`, roomId: i === 4 ? null : `r${i}`, kind: 'lesson',
      students: [{ id: i % 2 ? 's2' : 's1', name: i % 2 ? '학생 나' : '학생 가', attendanceDays: [] }] })),
    outside: [{ id: 'math-1', classId: 'math', name: '수학 1', subject: 'math', day: 'mon', start: '18:00', end: '19:00', teacher: '수학 강사', teacherId: 'tm', room: '301', roomId: 'rm', kind: 'lesson', students: [{ id: 's1', name: '학생 가', attendanceDays: [] }] }],
  };
}
