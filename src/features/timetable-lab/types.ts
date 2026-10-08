import type { PeriodsConfig } from '../timetable/lib/periods';
import type { IntegrationGroupsConfig } from '../timetable/lib/class-grid';
export type LabColor = { bg: string; text: string };
export type LabAppearance = {
  teacherColors: Record<string, LabColor>; teacherNicknames: Record<string, string>;
  periods: PeriodsConfig; groups: IntegrationGroupsConfig | null; compactSections: number[];
  hideEmptyDays: boolean; hideStudents: boolean; pxPerMin: number;
  sectionLines: number[]; excludedTeachers: string[]; breaks: { start: string; end: string }[];
  subjectColor: string;
  /** 강사뷰의 주말 칸 — 토요일은 기본으로 보이고(숨길 수 있다) 일요일은 기본으로 접혀 있다(펼 수 있다). 수업이 있는 칸은 늘 보인다. */
  hideSaturday?: boolean; showSunday?: boolean;
  hidePeriods?: boolean;
  scale?: number;
};
/** Read-only source snapshot. Importing creates a separate browser draft, never an operating write. */
export type LabSourceSlot = {
  id: string; classId: string; name: string; subject: string;
  day: string; start: string; end: string; teacher: string; teacherId: string | null;
  room: string; roomId: string | null; kind: 'lesson' | 'seat' | 'block';
  classColor?: LabColor; homeroomTeacher?: string; labSeparate?: boolean;
  note?: string; locked?: boolean;
  students: { id: string; name: string; grade?: string | null; school?: string | null; enrollmentId?: string; attendanceDays: string[] }[];
};
export type LabSource = {
  version: 1; tenantId: string; referenceDate: string; fetchedAt: string; subject: string;
  academy: string; stepMinutes: number; teacherOrder: string[];
  slots: LabSourceSlot[]; outside: LabSourceSlot[]; notices: string[]; uncertainties?: string[];
  appearance?: LabAppearance;
  baselineHash?: string;
};
