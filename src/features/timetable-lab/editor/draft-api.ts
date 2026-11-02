import type { DraftSummary } from '@/features/timetable-lab/draft-schema';
import type { Draft } from './model';
import { reasonOf } from './reason';
export type { DraftSummary };
async function request(path: string, init?: RequestInit) {
  const timeout = AbortSignal.timeout(20_000), signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const failed = '연습본을 읽거나 저장하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
  try {
    const response = await fetch(`/api/timetable/lab/drafts${path}`, { ...init, signal, credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(typeof data?.error === 'string' && /[가-힣]/.test(data.error) ? data.error : failed);
    return data;
  } catch (error) {
    // 저장 요청만 서버에 이미 반영됐을 수 있다. 읽기는 다시 시도하면 된다.
    if (timeout.aborted) throw new Error(init?.method ? '응답이 늦어 결과를 확인하지 못했습니다. 목록을 다시 읽어 저장됐는지 먼저 확인해 주세요.'
      : '응답이 늦어 연습본을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
    // 연결이 끊기면 브라우저가 영문 오류를 던진다 — 그대로 보이지 않게 바꾼다. 요청을 스스로 거둔 것(창 닫기)은 그대로 넘긴다.
    if (init?.signal?.aborted) throw error;
    throw new Error(reasonOf(error, failed));
  }
}
export async function listDrafts(offset = 0, signal?: AbortSignal): Promise<{ items: DraftSummary[]; nextOffset: number | null }> {
  return request(`?offset=${offset}&limit=20`, { signal });
}
function draftBody(name: string, draft: Draft) {
  const body = JSON.stringify({ version: 1, name, snapshot: draft });
  if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error('연습본이 너무 큽니다. 불필요한 수업 배치를 줄여 주세요.');
  return body;
}
export async function saveDraft(name: string, draft: Draft): Promise<DraftSummary> {
  return (await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: draftBody(name, draft) })).item;
}
export async function overwriteDraft(id: string, name: string, draft: Draft): Promise<DraftSummary> {
  return (await request(`/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: draftBody(name, draft) })).item;
}
export async function deleteDraft(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function loadDraft(id: string): Promise<{ item: DraftSummary; draft: Draft }> {
  const data = await request(`/${encodeURIComponent(id)}`);
  const { boundedJson, draftSnapshotSchema } = await import('@/features/timetable-lab/draft-schema')
    .catch(() => { throw new Error('연습본을 여는 데 필요한 파일을 받지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.'); });
  if (data.version !== 1 || !boundedJson(data.snapshot)) throw new Error('저장된 연습본의 형식을 확인하지 못했습니다. 현재 시간표는 유지합니다.');
  const parsed = draftSnapshotSchema.safeParse(data.snapshot);
  if (!parsed.success) throw new Error('저장된 연습본의 형식을 확인하지 못했습니다. 현재 시간표는 유지합니다.');
  return { item: data.item, draft: parsed.data as Draft };
}
