import type { LabAppearance, LabColor } from '@/features/timetable-lab/types';
// Browser draft only. Imported IDs are retained; no production mutation API exists here.
export type Cell = { text: string; bold?: boolean; formula?: string; format?: Record<string, unknown>; richText?: Record<string, unknown> };
export type Placement = { id: string; sourceScheduleId: string | null; classId: string; row: number;
  teacherId?: string | null; roomId?: string | null; kind?: 'lesson' | 'seat' | 'block'; studentIds?: string[]; labSeparate?: boolean;
  /** 잠근 수업은 옮기기·길이 변경·지우기를 거절한다(실수 방지). */ locked?: boolean; /** 연습본에만 남는 메모. */ note?: string };
export type Draft = { cells: Cell[][]; placements: Placement[]; students: Record<string, string[]>;
  appearance?: LabAppearance; classes?: Record<string, { name?: string; color?: LabColor; homeroomTeacher?: string }>;
  classRevision?: number; originId?: string; operatingHours?: Record<string, { start: number; end: number }[]>;
  /** 강사 열의 순서. 강사를 더하거나 순서를 바꾸면 그때의 순서를 여기에 굳힌다(수업이 없는 강사 열도 남는다). */ teachers?: string[];
  studentMoves?: Record<string, Record<string, { fromClassId: string; fromName: string }>>;
  people?: Record<string, string>; outside?: Lesson[]; source?: { kind: 'live'; date: string; tenantId: string; loadedAt: string; academy: string; notices: string[]; uncertainties?: string[]; step: number; teacherOrder: string[] } };
export const headers = ['수업', '요일', '시작', '종료', '강사', '강의실'];
export const days = ['월', '화', '수', '목', '금', '토', '일'];
export const studentLabels: Record<string, string> = { s1: '학생 가', s2: '학생 나', s3: '학생 다' };
export const labelsOf = (draft: Draft) => draft.people ?? studentLabels;
export function emptyDraft(): Draft { return { cells: [headers.map(text => ({ text, bold: true }))], placements: [], students: {}, people: {}, outside: [] }; }
export const makeFixture = (): Draft => ({
  cells: [headers, ['영어 A', '월', '18:00', '19:00', '강사 가', '201'],
    ['영어 B', '화', '18:00', '19:00', '강사 나', '202'],
    ['영어 C', '목', '19:00', '20:00', '강사 가', '201'],
    ...Array.from({ length: 6 }, () => Array(6).fill(''))]
    .map((row, r) => row.map(text => ({ text, bold: r === 0 }))),
  placements: [1, 2, 3].map(row => ({ id: `placement-${row}`, sourceScheduleId: `schedule-${row}`, classId: `class-${row}`, row })),
  students: { 'class-1': ['s1'], 'class-2': ['s2'], 'class-3': ['s3'] },
});
export type Patch = { row: number; col: number; cell: Cell };
export function patchCells(draft: Draft, patches: Patch[]): Draft {
  if (patches.some(p => !draft.cells[p.row]?.[p.col])) throw new Error('표 범위를 벗어났습니다.');
  const next = structuredClone(draft);
  for (const p of patches) next.cells[p.row][p.col] = structuredClone(p.cell);
  return next;
}
export function assignStudent(draft: Draft, studentId: string, classId: string): Draft {
  if (!labelsOf(draft)[studentId] || !draft.placements.some(p => p.classId === classId)) throw new Error('학생 또는 수업을 확인하세요.');
  const next = structuredClone(draft);
  for (const key of Object.keys(next.students)) next.students[key] = next.students[key].filter(id => id !== studentId);
  next.students[classId].push(studentId);
  return next;
}
export function timeMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}
export function timeLabel(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
export type Lesson = Placement & { name: string; day: string; start: number; end: number; teacher: string; room: string; students: string[] };
export function lessons(draft: Draft): { items: Lesson[]; incomplete: string[] } {
  const items: Lesson[] = [], incomplete: string[] = [];
  for (const p of draft.placements) {
    const row = draft.cells[p.row] ?? [];
    const [cellName, day, startText, endText, teacher, room] = row.map(c => c.text);
    const name = draft.classes?.[p.classId]?.name ?? cellName;
    const start = timeMinutes(startText), end = timeMinutes(endText);
    if (!name || !days.includes(day) || start === null || end === null || start >= end) {
      incomplete.push(`${name || p.id}: 요일·시간·강사·방의 확정된 값을 확인하세요.`);
      continue;
    }
    if (!teacher || teacher === '담당 미정' || (!room && p.kind !== 'block' && p.kind !== 'seat')) incomplete.push(`${name}: 강사 또는 강의실 미정 — 배치는 유지되지만 검사를 완료할 수 없습니다.`);
    items.push({ ...p, name, day, start, end, teacher: teacher || '담당 미정', room, students: p.studentIds ?? draft.students[p.classId] ?? [] });
  }
  return { items, incomplete };
}
