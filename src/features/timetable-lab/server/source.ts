import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPaged, fetchAllPagedInChunks } from '@/lib/supabase/batch';
import { getScheduleSlotsForWeek, getTeacherLabelMapStrict } from '@/features/timetable/server/queries';
import { getTenantSettings } from '@/features/owner/server/queries';
import { weekBoundsOf } from '@/features/timetable/lib/week';
import { projectSlots, projectBlocks, type RosterRow, type TeacherRow, type BlockRow } from './projection';
import type { LabSource } from '../types';
import { projectAppearance } from './appearance';
import { readSourceGroupPlans } from './source-groups';
import { pickScheduledGroupsForWeek } from '@/features/timetable/scheduled-groups';

/** Caller must check tenant-aware full timetable/classes permissions before reading. Session RLS remains enabled. */
export async function readLabSource(tenantId: string, referenceDate: string, userId: string): Promise<LabSource> {
  const db = await createClient(), week = weekBoundsOf(referenceDate);
  const [slots, blockRows, settings, teachers, labelMap, preferences, groupPlans] = await Promise.all([
    getScheduleSlotsForWeek(referenceDate),
    fetchAllPaged<BlockRow>((from, to) => db.from('teacher_schedule_blocks')
      .select('id, teacher_label, day_of_week, start_time, end_time, label, valid_from, valid_to')
      .eq('tenant_id', tenantId).eq('subject', 'english').lte('valid_from', week.end)
      .or(`valid_to.is.null,valid_to.gte.${week.start}`).order('id').range(from, to)),
    getTenantSettings(),
    fetchAllPaged<TeacherRow>((from, to) => db.from('users').select('id, display_name, english_name, status, bg_color, text_color').eq('tenant_id', tenantId).order('id').range(from, to)),
    getTeacherLabelMapStrict(),
    db.from('users').select('ui_prefs').eq('tenant_id', tenantId).eq('id', userId).single(),
    readSourceGroupPlans(db, tenantId, week.end),
  ]);
  if (preferences.error) throw preferences.error;
  const sourceSettings = structuredClone(settings), englishSettings = sourceSettings.operations.subjects.find(s => s.key === 'english');
  if (englishSettings) {
    const scheduled = pickScheduledGroupsForWeek(groupPlans, week.end, 'english', englishSettings.integrationGroups);
    if (scheduled) englishSettings.integrationGroups = scheduled.groups;
  }
  const visual = projectAppearance(sourceSettings, teachers, labelMap, preferences.data.ui_prefs);
  const classIds = [...new Set(slots.map(s => s.classId))];
  const roster = await fetchAllPagedInChunks<RosterRow>(classIds, (ids, from, to) => db.from('enrollments')
    .select('id, class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days, student:student_id(name, status, withdrawn_at)')
    .eq('tenant_id', tenantId).in('class_id', ids).lte('start_date', week.end)
    .or(`end_date.is.null,end_date.gte.${week.start}`).order('id').range(from, to));
  const projected = projectSlots(slots, roster, teachers, referenceDate, labelMap);
  const englishSlots = projected.filter(s => s.subject === 'english');
  const englishStudents = new Set(englishSlots.flatMap(s => s.students.map(p => p.id)));
  const english = settings.operations.subjects.find(s => s.key === 'english');
  const blocks = projectBlocks(blockRows, referenceDate, labelMap, teachers);
  const unknown = [...new Set([...projected, ...blocks].filter(s => s.kind !== 'seat' && !s.teacherId).map(s => s.teacher || '담당 미정'))];
  return { version: 1, tenantId, referenceDate, fetchedAt: new Date().toISOString(), subject: 'english',
    academy: [settings.profile?.name, settings.profile?.branchLabel].filter(Boolean).join(' '),
    stepMinutes: english?.teacherViewStep ?? 10, ...visual,
    slots: [...englishSlots, ...blocks],
    outside: projected.filter(s => s.subject !== 'english').map(s => ({ ...s, students: s.students.filter(p => englishStudents.has(p.id)) })),
    notices: ['선택한 주의 수업 날짜에 수강 중인 학생을 가져옵니다. 휴원·수강 대기 학생은 제외합니다.',
      '출결·교시 고정·합반 예외의 전체 검사는 아직 연결하지 않았습니다.'],
    uncertainties: unknown.map(name => `${name}: 담당 강사를 특정할 수 없어 강사 겹침 검사를 완료할 수 없습니다.`),
  };
}
