import { z } from 'zod';
import { readDraft } from '@/features/timetable-lab/server/drafts';
import { draftError, draftHeaders, draftUser } from '@/features/timetable-lab/server/draft-http';
import { logDbError } from '@/lib/supabase/db-error';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await draftUser(); if (auth.error) return auth.error;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return draftError('불러올 연습본을 확인해 주세요.', 400);
  try {
    const result = await readDraft(auth.user.tenantId, auth.user.id, id);
    return result ? Response.json(result, { headers: draftHeaders }) : draftError('연습본을 찾을 수 없습니다. 현재 계정에서 저장한 연습본인지 확인해 주세요.', 404);
  } catch (error) { logDbError(error, 'timetable-lab-draft-load'); return draftError('연습본을 불러오지 못했습니다. 편집 중인 내용은 유지됩니다.', 503); }
}
