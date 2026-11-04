import { z } from 'zod';

export const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const text = z.string().max(500), id = z.string().min(1).max(200);
const ids = z.array(id).max(20000);
const key = z.string().max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const record = <T extends z.ZodType>(value: T) => z.record(key, value);
const minute = z.number().int().min(0).max(1440);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const color = z.strictObject({ bg: z.string().max(50), text: z.string().max(50) });
const period = z.strictObject({ startTime: time, endTime: time, label: text.optional() });
const appearance = z.strictObject({
  teacherColors: record(color), teacherNicknames: record(text),
  periods: z.strictObject({ weekday: record(period), weekend: record(period),
    weekdayBySubject: record(record(period)).optional(), plain: z.boolean().optional() }),
  groups: z.strictObject({ groups: z.array(z.strictObject({ id, title: text, classIds: ids })).max(1000),
    showOthers: z.boolean(), othersTitle: text }).nullable(),
  compactSections: z.array(z.number().finite()).max(1000), hideEmptyDays: z.boolean(), hideStudents: z.boolean(),
  pxPerMin: z.number().positive().max(20), sectionLines: z.array(minute).max(1000), excludedTeachers: ids,
  breaks: z.array(z.strictObject({ start: time, end: time })).max(1000), subjectColor: text,
  // 편집기에서 고르는 주말 칸 보기 — 없던 연습본도 그대로 읽히게 선택 항목으로 둔다.
  hideSaturday: z.boolean().optional(), showSunday: z.boolean().optional(), hidePeriods: z.boolean().optional(),
  scale: z.number().min(.5).max(2).optional(),
});
const placementFields = {
  id, sourceScheduleId: id.nullable(), classId: z.string().max(200), row: z.number().int(),
  teacherId: id.nullable().optional(), roomId: id.nullable().optional(),
  kind: z.enum(['lesson', 'seat', 'block']).optional(), studentIds: ids.optional(), labSeparate: z.boolean().optional(),
  // 편집기가 붙이는 표시 — 잠금과 연습본 메모.
  locked: z.boolean().optional(), note: z.string().max(300).optional(),
};
const lesson = z.strictObject({ ...placementFields, name: text, day: z.enum(['월', '화', '수', '목', '금', '토', '일']),
  start: minute, end: minute, teacher: text, room: text, students: ids });
// Formatting is opaque to the scheduler, but still bounded JSON (not arbitrary executable objects).
const jsonObject = z.record(key, z.json());
export const draftSnapshotSchema = z.strictObject({
  cells: z.array(z.array(z.strictObject({ text: z.string().max(10000), bold: z.boolean().optional(),
    formula: z.string().max(10000).optional(), format: jsonObject.optional(), richText: jsonObject.optional() })).min(6).max(100)).min(1).max(20001),
  placements: z.array(z.strictObject(placementFields)).max(5000), students: record(ids),
  classes: record(z.strictObject({ name: text.optional(), color: color.optional(), homeroomTeacher: text.optional() })).optional(),
  people: record(text).optional(), outside: z.array(lesson).max(20000).optional(), appearance: appearance.optional(),
  classRevision: z.number().int().nonnegative().optional(), originId: id.optional(),
  // 강사 열의 순서(수업이 없는 새 강사 열 포함).
  teachers: z.array(z.string().min(1).max(40)).max(500).optional(),
  studentMoves: record(record(z.strictObject({ fromClassId: id, fromName: text }))).optional(),
  studentDetails: record(z.strictObject({ grade: text.nullable(), school: text.nullable() })).optional(),
  operatingHours: record(z.array(z.strictObject({ start: minute, end: minute }).refine(v => v.start < v.end)).max(100)).optional(),
  source: z.strictObject({ kind: z.literal('live'), date: z.iso.date(), tenantId: z.uuid(), loadedAt: z.iso.datetime({ offset: true }),
    academy: text, notices: z.array(text).max(2000), uncertainties: z.array(text).max(2000).optional(),
    step: z.number().int().positive().max(60), teacherOrder: ids, baselineHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), importedIds: ids.optional(), importedClassIds: ids.optional(), initialAppearance: appearance.optional(), initialTeacherOrder: ids.optional(), initialStudents: record(ids).optional(), initialSlotMetadata: record(z.strictObject({ note: z.string().max(300), locked: z.boolean() })).optional(),
    initialPlacements: record(z.strictObject({name:text,classId:z.string().max(200),day:z.enum(['월','화','수','목','금','토','일']),start:minute,end:minute,teacher:text,room:text,labSeparate:z.boolean(),students:ids})).optional(),
    initialClasses: record(z.strictObject({name:text,homeroomTeacher:text.optional(),color:color.optional()})).optional() }).optional(),
}).superRefine((draft, ctx) => {
  const seen = new Set<string>(), rows = new Set<number>();
  for (const p of draft.placements) {
    if (seen.has(p.id) || rows.has(p.row) || p.row < 1 || p.row >= draft.cells.length || (!p.classId && p.kind !== 'block')) {
      ctx.addIssue({ code: 'custom', message: '수업 식별자 또는 표의 위치를 확인해 주세요.' }); break;
    }
    seen.add(p.id); rows.add(p.row);
  }
});
export const saveDraftSchema = z.strictObject({ version: z.literal(1), name: z.string().trim().min(1).max(100), snapshot: draftSnapshotSchema });
export type SavedDraftSnapshot = z.infer<typeof draftSnapshotSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type DraftSummary = { id: string; name: string; subject: 'english'; createdAt: string;
  createdBy: string; createdByName: string | null;
  lessonCount: number; classCount: number; studentCount: number; referenceDate: string | null;
  /** 지금 계정이 덮어쓰거나 지울 수 있는가 — 서버가 다시 본다. */ manageable?: boolean };

/** Reject pathological nested formatting before recursive schema validation. */
export function boundedJson(value: unknown): boolean {
  const pending = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 250000 || item.depth > 30) return false;
    if (item.value && typeof item.value === 'object') {
      for (const [name, child] of Object.entries(item.value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(name)) return false;
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return true;
}
