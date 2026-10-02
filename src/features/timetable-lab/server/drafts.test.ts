import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mock.client }));
import { createDraft, listDrafts, readDraft } from './drafts';
const row = { id: 'one', name: '첫 안', subject: 'english', created_at: '2026-10-02T00:00:00Z',
  lesson_count: 2, class_count: 1, student_count: 1, reference_date: null };
const snapshot = () => ({ cells: [Array.from({ length: 6 }, () => ({ text: '' }))], placements: [], students: {} });
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), insert: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() };
  for (const method of [q.select, q.eq, q.order, q.insert]) method.mockReturnValue(q);
  for (const method of [q.range, q.single, q.maybeSingle]) method.mockResolvedValue({ data, error });
  mock.client.mockResolvedValue({ from: vi.fn().mockReturnValue(q) }); return q;
}
beforeEach(() => vi.clearAllMocks());
describe('draft storage queries', () => {
  it('lists summaries using two ownership filters, stable order, and one lookahead row', async () => {
    const q = query([row, { ...row, id: 'two' }, { ...row, id: 'three' }]); const result = await listDrafts('tenant', 'user', 20, 2);
    expect(q.select.mock.calls[0][0]).not.toContain('snapshot'); expect(q.eq.mock.calls).toEqual([['tenant_id', 'tenant'], ['created_by', 'user'], ['subject', 'english']]);
    expect(q.range).toHaveBeenCalledWith(20, 22); expect(q.order.mock.calls).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(result.items.map(item => item.id)).toEqual(['one', 'two']); expect(result.nextOffset).toBe(22);
  });
  it('calculates distinct roster totals from active placements, not stale fallback rosters', async () => {
    const q = query(row); const draft = { ...snapshot(), students: { c1: ['removed'] }, placements: [
      { id: 'p1', sourceScheduleId: null, classId: 'c1', row: 1, studentIds: ['student1'] },
      { id: 'p2', sourceScheduleId: null, classId: 'c1', row: 2, studentIds: ['student1'] },
      { id: 'p3', sourceScheduleId: null, classId: '', row: 3, kind: 'block' as const, studentIds: [] },
    ] };
    await createDraft('tenant', 'user', { version: 1, name: '안', snapshot: draft });
    expect(q.insert.mock.calls[0][0]).toMatchObject({ tenant_id: 'tenant', created_by: 'user', lesson_count: 2, class_count: 1, student_count: 1, snapshot: draft });
  });
  it('validates stored snapshots again on load before they reach the editor', async () => {
    const q = query({ ...row, version: 1, snapshot: snapshot() }); expect((await readDraft('tenant', 'user', 'one'))?.snapshot).toEqual(snapshot());
    expect(q.eq.mock.calls).toEqual([['tenant_id', 'tenant'], ['created_by', 'user'], ['subject', 'english'], ['id', 'one']]);
    query({ ...row, version: 1, snapshot: { bad: 'shape' } }); await expect(readDraft('tenant', 'user', 'one')).rejects.toThrow();
    query(null); expect(await readDraft('tenant', 'user', 'missing')).toBeNull();
  });
  it('does not turn database errors into an empty list or missing draft', async () => {
    query(null, new Error('failed')); await expect(listDrafts('tenant', 'user', 0, 20)).rejects.toThrow('failed');
    await expect(readDraft('tenant', 'user', 'one')).rejects.toThrow('failed');
  });
});
