import type { LabAppearance } from '../types';
import type { TenantSettings } from '@/features/owner/settings-types';
import { settingsToPeriodsConfig } from '@/features/timetable/lib/periods';
import { resolveIntegrationGroups } from '@/features/timetable/lib/integration-groups';
import { buildTeacherNicknameMap, resolveTeacherLabels, type TeacherLabelMap } from '@/features/timetable/lib/teacher-label';
import { parseViewPrefs } from '@/features/timetable/lib/view-prefs';
import type { TeacherRow } from './projection';

/** The same saved appearance used by the operating views, copied into the draft. */
export function projectAppearance(settings: TenantSettings, teachers: TeacherRow[], labels: TeacherLabelMap, rawPrefs: unknown) {
  const prefs = parseViewPrefs(rawPrefs), english = settings.operations.subjects.find(s => s.key === 'english');
  const teacherColors: LabAppearance['teacherColors'] = {};
  for (const teacher of teachers) {
    if (!teacher.bg_color) continue;
    const color = { bg: teacher.bg_color, text: teacher.text_color || '#121212' };
    for (const name of [teacher.display_name, teacher.english_name]) if (name) teacherColors[name] = color;
  }
  const personal = prefs.teacherOrder?.english?.teacherview;
  const teacherOrder = resolveTeacherLabels(personal?.length ? personal : english?.teacherViewOrder ?? [], labels);
  const appearance: LabAppearance = {
    teacherColors, teacherNicknames: buildTeacherNicknameMap(teachers.map(t => ({ displayName: t.display_name,
      englishName: t.english_name ?? null, active: t.status === 'active' }))),
    periods: settingsToPeriodsConfig(settings.operations), groups: resolveIntegrationGroups(english),
    compactSections: prefs.compact1h?.english ?? [], hideEmptyDays: prefs.hideEmptyDays ?? false,
    hideStudents: prefs.hideStudents ?? false, pxPerMin: english?.teacherViewPxPerMin ?? 1.4,
    sectionLines: (english?.teacherViewLines ?? []).map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }),
    excludedTeachers: resolveTeacherLabels(english?.teacherViewLineExcluded ?? [], labels),
    breaks: english?.teacherViewBreaks ?? [], subjectColor: english?.color ?? 'neutral',
  };
  return { appearance, teacherOrder };
}

/**
 * 빈 연습본(직접 만들기)의 출발점 — 교시·쉬는 시간·줄 간격 같은 **학원설정**만 싣는다.
 * 안 실으면 편집기가 내장 기본 교시로 운영시간을 판정해, 설정을 바꾼 지점에서 "운영시간 밖"이라며 수업을 못 놓는다.
 * 강사·반·색은 편집기에서 만들거나 '기존 시간표 불러오기'로 가져온다.
 */
export function blankAppearance(settings: TenantSettings): LabAppearance {
  const english = settings.operations.subjects.find(s => s.key === 'english');
  return {
    teacherColors: {}, teacherNicknames: {}, periods: settingsToPeriodsConfig(settings.operations), groups: null,
    compactSections: [], hideEmptyDays: false, hideStudents: false, pxPerMin: english?.teacherViewPxPerMin ?? 1.4,
    sectionLines: (english?.teacherViewLines ?? []).map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }),
    excludedTeachers: [], breaks: english?.teacherViewBreaks ?? [], subjectColor: english?.color ?? 'neutral',
  };
}
