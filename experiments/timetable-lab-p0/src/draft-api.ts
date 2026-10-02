import type { DraftSummary } from '../../../src/features/timetable-lab/draft-schema';
import type { Draft } from './model';
export type { DraftSummary };
async function request(path: string, init?: RequestInit) {
  const timeout = AbortSignal.timeout(20_000), signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const response = await fetch(`/api/timetable/lab/drafts${path}`, { ...init, signal, credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || '연습본을 읽거나 저장하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    return data;
  } catch (error) {
    // 저장 요청만 서버에 이미 반영됐을 수 있다. 읽기는 다시 시도하면 된다.
    if (timeout.aborted) throw new Error(init?.method === 'POST' ? '응답이 늦어 결과를 확인하지 못했습니다. 목록을 다시 읽어 저장됐는지 먼저 확인해 주세요.'
      : '응답이 늦어 연습본을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
    throw error;
  }
}
export async function listDrafts(offset = 0, signal?: AbortSignal): Promise<{ items: DraftSummary[]; nextOffset: number | null }> {
  return request(`?offset=${offset}&limit=20`, { signal });
}
export async function saveDraft(name: string, draft: Draft): Promise<DraftSummary> {
  const body = JSON.stringify({ version: 1, name, snapshot: draft });
  if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error('연습본이 너무 큽니다. 불필요한 수업 배치를 줄여 주세요.');
  return (await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).item;
}
export async function loadDraft(id: string): Promise<{ item: DraftSummary; draft: Draft }> {
  const data = await request(`/${encodeURIComponent(id)}`);
  const { boundedJson, draftSnapshotSchema } = await import('../../../src/features/timetable-lab/draft-schema');
  if (data.version !== 1 || !boundedJson(data.snapshot)) throw new Error('저장된 연습본의 형식을 확인하지 못했습니다. 현재 시간표는 유지합니다.');
  const parsed = draftSnapshotSchema.safeParse(data.snapshot);
  if (!parsed.success) throw new Error('저장된 연습본의 형식을 확인하지 못했습니다. 현재 시간표는 유지합니다.');
  return { item: data.item, draft: parsed.data as Draft };
}
