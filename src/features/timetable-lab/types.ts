import type { PeriodsConfig } from '../timetable/lib/periods';
import type { IntegrationGroupsConfig } from '../timetable/lib/class-grid';
export type LabColor = { bg: string; text: string };
export type LabAppearance = {
  teacherColors: Record<string, LabColor>; teacherNicknames: Record<string, string>;
  periods: PeriodsConfig; groups: IntegrationGroupsConfig | null; compactSections: number[];
  hideEmptyDays: boolean; hideStudents: boolean; pxPerMin: number;
  sectionLines: number[]; excludedTeachers: string[]; breaks: { start: string; end: string }[];
  subjectColor: string;
};
/** Read-only source snapshot. Importing creates a separate browser draft, never an operating write. */
export type LabSourceSlot = {
  id: string; classId: string; name: string; subject: string;
  day: string; start: string; end: string; teacher: string; teacherId: string | null;
  room: string; roomId: string | null; kind: 'lesson' | 'seat' | 'block';
  classColor?: LabColor; homeroomTeacher?: string; labSeparate?: boolean;
  students: { id: string; name: string; enrollmentId?: string; attendanceDays: string[] }[];
};
export type LabSource = {
  version: 1; tenantId: string; referenceDate: string; fetchedAt: string; subject: string;
  academy: string; stepMinutes: number; teacherOrder: string[];
  slots: LabSourceSlot[]; outside: LabSourceSlot[]; notices: string[]; uncertainties?: string[];
  appearance?: LabAppearance;
};
