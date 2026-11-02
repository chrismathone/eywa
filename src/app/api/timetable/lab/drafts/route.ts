import { canManageDraft, createDraft, listDrafts, managesEnglishDrafts } from '@/features/timetable-lab/server/drafts';
import { draftError, draftHeaders, draftUser, readDraftBody } from '@/features/timetable-lab/server/draft-http';
import { logAction } from '@/features/audit/server/log';
import { logDbError } from '@/lib/supabase/db-error';

export async function GET(request: Request) {
  const auth = await draftUser(); if (auth.error) return auth.error;
  const params = new URL(request.url).searchParams, offsetText = params.get('offset') ?? '0', limitText = params.get('limit') ?? '20';
  const offset = Number(offsetText), limit = Number(limitText);
  if (!/^\d+$/.test(offsetText) || !/^\d+$/.test(limitText) || !Number.isSafeInteger(offset) || offset > 100000 || limit < 1 || limit > 50) {
    return draftError('불러올 목록 범위를 확인해 주세요.', 400);
  }
  try {
    const [list, subjectManager] = await Promise.all([listDrafts(auth.user.tenantId, offset, limit), managesEnglishDrafts(auth.user)]);
    return Response.json({ ...list, items: list.items.map(item => ({ ...item, manageable: canManageDraft(auth.user.id, item.createdBy, subjectManager) })) }, { headers: draftHeaders });
  }
  catch (error) { logDbError(error, 'timetable-lab-draft-list'); return draftError('저장된 연습본 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 503); }
}
export async function POST(request: Request) {
  const auth = await draftUser(); if (auth.error) return auth.error;
  const body = await readDraftBody(request); if (body.error) return body.error;
  if (body.input.snapshot.source && body.input.snapshot.source.tenantId !== auth.user.tenantId) return draftError('현재 지점에서 불러온 시간표만 저장할 수 있습니다.', 403);
  let saved: Awaited<ReturnType<typeof createDraft>>;
  try { saved = await createDraft(auth.user.tenantId, auth.user.id, body.input); }
  catch (error) { logDbError(error, 'timetable-lab-draft-save'); return draftError('연습본을 저장하지 못했습니다. 편집 중인 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.', 503); }
  // 저장이 끝난 뒤에만 남긴다. 기록 실패는 저장 결과를 바꾸지 않는다(logAction이 스스로 삼킨다).
  await logAction({ action: 'timetable_lab_draft_save', targetType: 'timetable_lab_draft', targetLabel: saved.item.name,
    metadata: { draftId: saved.item.id, lessonCount: saved.item.lessonCount, classCount: saved.item.classCount,
      studentCount: saved.item.studentCount, referenceDate: saved.item.referenceDate } });
  return Response.json({ item: { ...saved.item, manageable: true } }, { status: 201, headers: draftHeaders });
}
