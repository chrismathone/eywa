import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { boundedJson, draftSnapshotSchema, type DraftSummary, type SaveDraftInput } from '../draft-schema';

const columns = 'id,name,subject,created_at,created_by,author:created_by(display_name),lesson_count,class_count,student_count,reference_date';
type SummaryRow = { id: string; name: string; subject: 'english'; created_at: string; lesson_count: number;
  class_count: number; student_count: number; reference_date: string | null; created_by: string;
  author: { display_name: string | null } | { display_name: string | null }[] | null };
function summary(row: SummaryRow): DraftSummary {
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  return { id: row.id, name: row.name, subject: row.subject, createdAt: row.created_at,
    createdBy: row.created_by, createdByName: author?.display_name ?? null,
    lessonCount: row.lesson_count, classCount: row.class_count, studentCount: row.student_count, referenceDate: row.reference_date };
}
/** Session client + explicit branch filter. Lists never retrieve snapshot JSON. */
export async function listDrafts(tenantId: string, offset: number, limit: number) {
  const db = await createClient();
  const { data, error } = await db.from('timetable_lab_drafts').select(columns)
    .eq('tenant_id', tenantId).eq('subject', 'english')
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit);
  if (error) throw error;
  const rows = data as SummaryRow[];
  return { items: rows.slice(0, limit).map(summary), nextOffset: rows.length > limit ? offset + limit : null };
}
export async function createDraft(tenantId: string, userId: string, input: SaveDraftInput) {
  const db = await createClient(), draft = input.snapshot;
  const lessons = draft.placements.filter(p => p.kind !== 'block');
  const studentIds = new Set(lessons.flatMap(p => p.studentIds ?? draft.students[p.classId] ?? []));
  const { data, error } = await db.from('timetable_lab_drafts').insert({ tenant_id: tenantId, created_by: userId,
    name: input.name, subject: 'english', version: 1, snapshot: draft,
    lesson_count: lessons.length, class_count: new Set(lessons.map(p => p.classId)).size, student_count: studentIds.size,
    reference_date: draft.source?.date ?? null }).select(columns).single();
  if (error) throw error;
  return { item: summary(data as SummaryRow) };
}
export async function readDraft(tenantId: string, id: string) {
  const db = await createClient();
  const { data, error } = await db.from('timetable_lab_drafts').select(`${columns},version,snapshot`)
    .eq('tenant_id', tenantId).eq('subject', 'english').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Direct Data API inserts must not turn a later load into an invalid editor state.
  if (data.version !== 1 || !boundedJson(data.snapshot)) throw new Error('Invalid saved timetable draft');
  const snapshot = draftSnapshotSchema.parse(data.snapshot);
  if (snapshot.source && snapshot.source.tenantId !== tenantId) throw new Error('Invalid draft source tenant');
  return { version: 1 as const, item: summary(data as SummaryRow), snapshot };
}
