import { z } from 'zod';
import { canManageDraft, deleteDraft, managesEnglishDrafts, overwriteDraft, readDraft, readDraftTarget } from '@/features/timetable-lab/server/drafts';
import { draftError, draftHeaders, draftUser, readDraftBody } from '@/features/timetable-lab/server/draft-http';
import { logAction } from '@/features/audit/server/log';
import { logDbError } from '@/lib/supabase/db-error';

const GONE = '연습본을 찾을 수 없습니다. 목록을 다시 읽어 주세요.', DENIED = '저장한 사람과 영어 과목 관리자 이상만 덮어쓰거나 삭제할 수 있습니다.';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await draftUser(); if (auth.error) return auth.error;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftError('불러올 연습본을 확인해 주세요.', 400);
  try {
    const result = await readDraft(auth.user.tenantId, id);
    return result ? Response.json(result, { headers: draftHeaders }) : draftError('연습본을 찾을 수 없습니다. 현재 지점에 저장된 연습본인지 확인해 주세요.', 404);
  } catch (error) { logDbError(error, 'timetable-lab-draft-load'); return draftError('연습본을 불러오지 못했습니다. 편집 중인 내용은 유지됩니다.', 503); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await draftUser(); if (auth.error) return auth.error;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftError('덮어쓸 연습본을 확인해 주세요.', 400);
  const body = await readDraftBody(request); if (body.error) return body.error;
  if (body.input.snapshot.source && body.input.snapshot.source.tenantId !== auth.user.tenantId) return draftError('현재 지점에서 불러온 시간표만 저장할 수 있습니다.', 403);
  try {
    const target = await readDraftTarget(auth.user.tenantId, id);
    if (!target) return draftError(GONE, 404);
    if (!canManageDraft(auth.user.id, target.createdBy, await managesEnglishDrafts(auth.user))) return draftError(DENIED, 403);
    const saved = await overwriteDraft(auth.user.tenantId, auth.user.id, id, body.input);
    if (!saved) return draftError(GONE, 404);
    await logAction({ action: 'timetable_lab_draft_overwrite', targetType: 'timetable_lab_draft', targetLabel: saved.item.name,
      metadata: { draftId: id, lessonCount: saved.item.lessonCount, classCount: saved.item.classCount, studentCount: saved.item.studentCount, referenceDate: saved.item.referenceDate,
        previous: { name: target.name, savedBy: target.createdByName, savedAt: target.createdAt, lessonCount: target.lessonCount } } });
    return Response.json({ item: { ...saved.item, manageable: true } }, { headers: draftHeaders });
  } catch (error) { logDbError(error, 'timetable-lab-draft-overwrite'); return draftError('연습본을 덮어쓰지 못했습니다. 편집 중인 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.', 503); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await draftUser(); if (auth.error) return auth.error;
  const { id } = await context.params;
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return draftError('시간표 편집기에서 다시 시도해 주세요.', 403);
  if (!z.uuid().safeParse(id).success) return draftError('삭제할 연습본을 확인해 주세요.', 400);
  try {
    const target = await readDraftTarget(auth.user.tenantId, id);
    if (!target) return draftError(GONE, 404);
    if (!canManageDraft(auth.user.id, target.createdBy, await managesEnglishDrafts(auth.user))) return draftError(DENIED, 403);
    if (!(await deleteDraft(auth.user.tenantId, id))) return draftError(GONE, 404);
    await logAction({ action: 'timetable_lab_draft_delete', targetType: 'timetable_lab_draft', targetLabel: target.name,
      metadata: { draftId: id, lessonCount: target.lessonCount, classCount: target.classCount, studentCount: target.studentCount, referenceDate: target.referenceDate,
        savedBy: target.createdByName, savedAt: target.createdAt } });
    return Response.json({ ok: true }, { headers: draftHeaders });
  } catch (error) { logDbError(error, 'timetable-lab-draft-delete'); return draftError('연습본을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503); }
}
