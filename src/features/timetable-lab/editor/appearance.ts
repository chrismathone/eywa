import type { Draft, Lesson } from './model';
import type { LabColor, LabAppearance } from '@/features/timetable-lab/types';
import { DEFAULT_PERIODS_CONFIG } from '@/features/timetable/lib/periods';
import { ENGLISH_SHEET_TEACHERS } from '@/features/timetable/lib/english-teacher-sheet';
import { teacherColor } from '@/features/timetable/lib/class-grid';
import { readableTextColor } from '@/lib/color-utils';

export const defaultAppearance: LabAppearance = {
  teacherColors: {}, teacherNicknames: {}, periods: DEFAULT_PERIODS_CONFIG, groups: null, compactSections: [],
  hideEmptyDays: false, hideStudents: false, pxPerMin: 1.4, sectionLines: [], excludedTeachers: [], breaks: [], subjectColor: 'neutral',
};
const palette: Record<string, string> = { blue: '#2962ce', purple: '#6c50c8', rose: '#b63767', green: '#0d7743',
  amber: '#995709', primary: '#363c41', neutral: '#555555', danger: '#b44832' };
export const appearanceOf = (draft: Draft) => draft.appearance ?? defaultAppearance;
export const paint = (color: LabColor) => ({ backgroundColor: color.bg, color: color.text });
export function subjectTone(draft: Draft): LabColor {
  const base = palette[appearanceOf(draft).subjectColor] ?? palette.neutral;
  return { bg: `${base}1f`, text: base };
}
export function teacherTone(draft: Draft, teacher: string, integrated = false): LabColor {
  const saved = appearanceOf(draft).teacherColors[teacher];
  if (saved) return saved;
  const bg = integrated ? palette[teacherColor(teacher)] ?? palette.neutral : ENGLISH_SHEET_TEACHERS[teacher]?.color ?? '#f1f1f1';
  return { bg, text: integrated ? '#ffffff' : readableTextColor(bg) };
}
export function lessonTone(draft: Draft, item: Lesson): LabColor {
  if (item.kind === 'block') return { bg: '#efefef', text: '#555555' };
  const classColor = draft.classes?.[item.classId]?.color;
  if (classColor) return classColor;
  if (item.kind !== 'seat' && (appearanceOf(draft).teacherColors[item.teacher] || ENGLISH_SHEET_TEACHERS[item.teacher])) return teacherTone(draft, item.teacher);
  return subjectTone(draft);
}
export function setPracticeColor(draft: Draft, target: 'teacher' | 'class', key: string, color: LabColor): Draft {
  if (![color.bg, color.text].every(c => /^#[0-9a-f]{6}$/i.test(c))) throw new Error('색상을 확인하세요.');
  const next = structuredClone(draft);
  if (target === 'teacher') { next.appearance ??= structuredClone(defaultAppearance); next.appearance.teacherColors[key] = color; }
  else { next.classes ??= {}; next.classes[key] = { ...next.classes[key], color }; }
  return next;
}
