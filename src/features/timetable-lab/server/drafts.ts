import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getViewerStaffScope } from '@/features/staff/department/server/subject-scope';
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
function contentOf(input: SaveDraftInput) {
  const draft = input.snapshot, lessons = draft.placements.filter(p => p.kind !== 'block');
  const studentIds = new Set(lessons.flatMap(p => p.studentIds ?? draft.students[p.classId] ?? []));
  return { name: input.name, snapshot: draft, lesson_count: lessons.length, class_count: new Set(lessons.map(p => p.classId)).size,
    student_count: studentIds.size, reference_date: draft.source?.date ?? null };
}
export async function createDraft(tenantId: string, userId: string, input: SaveDraftInput) {
  const db = await createClient();
  const { data, error } = await db.from('timetable_lab_drafts').insert({ tenant_id: tenantId, created_by: userId, subject: 'english', version: 1, ...contentOf(input) }).select(columns).single();
  if (error) throw error;
  return { item: summary(data as SummaryRow) };
}
/**
 * 덮어쓰기·삭제는 저장한 사람과 **그 과목 관리자 이상**만 — 지점이 함께 보는 저장본이라 남의 안을 지우면 안 된다(원장 2026-11-02).
 * 연습본은 영어뿐이다. 과목 범위는 퇴원보고서 열람과 같은 기준: 특수권한 과목 범위 → 직원의 담당 과목 → 둘 다 없으면 전 과목 · 원장은 늘 전부.
 */
export async function managesEnglishDrafts(user: { id: string; tenantId: string; systemRole: string }) {
  if (user.systemRole === 'master') return true;
  if (user.systemRole !== 'admin' && user.systemRole !== 'manager') return false;
  const scope = await getViewerStaffScope(user);
  if (scope) return scope.includes('english');
  const { data, error } = await createAdminClient().from('users').select('subjects').eq('tenant_id', user.tenantId).eq('id', user.id).maybeSingle();
  if (error) throw error;
  const own = ((data as { subjects: string[] | null } | null)?.subjects ?? []).filter(Boolean);
  return !own.length || own.includes('english');
}
export const canManageDraft = (userId: string, createdBy: string, subjectManager: boolean) => createdBy === userId || subjectManager;
export async function readDraftTarget(tenantId: string, id: string) {
  const db = await createClient();
  const { data, error } = await db.from('timetable_lab_drafts').select(columns).eq('tenant_id', tenantId).eq('subject', 'english').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? summary(data as SummaryRow) : null;
}
/**
 * 🔴 일반 계정은 이 표를 읽고 추가만 한다(0333a) — 덮어쓰기·삭제는 라우트가 `canManageDraft`로 확인한 뒤 관리 클라이언트로 쓴다.
 * 시각 칸은 `created_at` 하나뿐이라 덮어쓰면 저장자·저장 시각을 마지막 저장으로 옮긴다(목록이 '저장자 · 시각'으로 보여 준다). 이전 저장자는 감사로그에 남는다.
 */
export async function overwriteDraft(tenantId: string, userId: string, id: string, input: SaveDraftInput) {
  const { data, error } = await createAdminClient().from('timetable_lab_drafts').update({ ...contentOf(input), created_by: userId, created_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('subject', 'english').eq('id', id).select(columns).maybeSingle();
  if (error) throw error;
  return data ? { item: summary(data as SummaryRow) } : null;
}
export async function deleteDraft(tenantId: string, id: string) {
  const { data, error } = await createAdminClient().from('timetable_lab_drafts').delete().eq('tenant_id', tenantId).eq('subject', 'english').eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  return !!data;
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
