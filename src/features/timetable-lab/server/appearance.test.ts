import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/features/owner/defaults';
import { subjectSchema } from '@/features/owner/settings-types';
import { projectAppearance } from './appearance';
import { projectSlots } from './projection';
import type { ScheduleSlot } from '@/features/timetable/server/queries';

describe('practice source presentation', () => {
  it('copies the same tenant and personal settings used by the English views', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.operations.subjects = [subjectSchema.parse({ key: 'english', label: '영어', color: 'blue', integrationGroupsEnabled: true,
      integrationGroups: [{ id: 'g1', title: '첫 줄', classIds: ['c1'] }], teacherViewOrder: ['Jane'], teacherViewLines: ['16:20'],
      teacherViewLineExcluded: ['Jane'], teacherViewPxPerMin: 1.7, teacherViewBreaks: [{ start: '20:10', end: '20:20' }],
      weekdayPeriods: [{ label: '1교시', startTime: '15:00', endTime: '16:00' }] })];
    const result = projectAppearance(settings, [{ id: 'u1', display_name: '홍길동', english_name: 'Jane', status: 'active', bg_color: '#123456', text_color: '#ffffff' }],
      { Jane: '홍길동' }, { timetable: { teacherOrder: { english: { teacherview: ['LAB', 'Jane'] } }, compact1h: { english: [900] }, hideEmptyDays: true } });
    expect(result.teacherOrder).toEqual(['LAB', '홍길동']);
    expect(result.appearance).toMatchObject({ teacherColors: { '홍길동': { bg: '#123456', text: '#ffffff' }, Jane: { bg: '#123456', text: '#ffffff' } },
      teacherNicknames: { '홍길동': 'Jane' }, excludedTeachers: ['홍길동'], sectionLines: [980], pxPerMin: 1.7,
      hideEmptyDays: true, compactSections: [900], groups: { groups: [{ id: 'g1', title: '첫 줄', classIds: ['c1'] }] } });
    expect(result.appearance.periods.weekdayBySubject?.english['1'].startTime).toBe('15:00');
  });
  it('preserves class colors and homeroom independently from the slot teacher', () => {
    const slot = { id: 's', classId: 'c', className: 'English', subject: 'english', dayOfWeek: 'mon', startTime: '18:00', endTime: '19:00',
      teacherName: 'Jane', slotTeacherLabel: 'Sam', classroomName: '201', slotRoomLabel: null, classRoomId: null,
      classBgColor: '#aabbcc', classTextColor: '#112233' } as ScheduleSlot;
    expect(projectSlots([slot], [], [], '2026-09-28', { Jane: '홍길동', Sam: '김강사' })[0]).toMatchObject({
      teacher: '김강사', homeroomTeacher: '홍길동', classColor: { bg: '#aabbcc', text: '#112233' },
    });
  });
});
