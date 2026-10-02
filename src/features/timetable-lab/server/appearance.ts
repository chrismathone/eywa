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
