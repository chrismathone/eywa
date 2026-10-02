import 'server-only';
import { getCurrentUser } from '@/lib/auth/current-user';
import { canManageTenant } from '@/lib/auth/perm-matrix';
import { MAX_DRAFT_BYTES, boundedJson, saveDraftSchema } from '../draft-schema';

export const draftHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export function draftError(error: string, status: number) { return Response.json({ error }, { status, headers: draftHeaders }); }
export async function draftUser() {
  const user = await getCurrentUser();
  if (!user) return { error: draftError('로그인 후 연습본을 저장하거나 불러올 수 있습니다.', 401) };
  const grants = await Promise.all([canManageTenant(user.systemRole, 'timetable'), canManageTenant(user.systemRole, 'classes')]);
  if (grants.some(allowed => !allowed)) return { error: draftError('시간표와 반을 관리할 수 있는 계정으로 이용해 주세요.', 403) };
  return { user };
}
export async function readDraftBody(request: Request) {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return { error: draftError('시간표 편집기에서 다시 저장해 주세요.', 403) };
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return { error: draftError('저장할 연습본의 형식을 확인해 주세요.', 415) };
  const reader = request.body?.getReader();
  if (!reader) return { error: draftError('저장할 연습본이 없습니다.', 400) };
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_DRAFT_BYTES) { await reader.cancel(); return { error: draftError('연습본이 너무 커 저장할 수 없습니다. 2MB 이하로 나누어 주세요.', 413) }; }
      chunks.push(value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!boundedJson(raw)) return { error: draftError('연습본의 표 형식이 너무 복잡해 저장하지 못했습니다.', 400) };
    const parsed = saveDraftSchema.safeParse(raw);
    if (!parsed.success) return { error: draftError('연습본 이름 또는 시간표 자료 형식을 확인해 주세요.', 400) };
    return { input: parsed.data };
  } catch {
    return { error: draftError('연습본 자료를 읽지 못했습니다. 다시 저장해 주세요.', 400) };
  } finally { reader.releaseLock(); }
}
