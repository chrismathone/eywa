import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), scope: vi.fn() }));
vi.mock('@/features/staff/department/server/subject-scope', () => ({ getViewerStaffScope: mock.scope }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mock.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mock.admin }));
import { canManageDraft, createDraft, deleteDraft, listDrafts, managesEnglishDrafts, overwriteDraft, readDraft } from './drafts';
const row = { id: 'one', name: '첫 안', subject: 'english', created_at: '2026-10-02T00:00:00Z',
  lesson_count: 2, class_count: 1, student_count: 1, reference_date: null,
  created_by: 'colleague', author: { display_name: '저장 강사' } };
const snapshot = () => ({ cells: [Array.from({ length: 6 }, () => ({ text: '' }))], placements: [], students: {} });
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), insert: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() };
  for (const method of [q.select, q.eq, q.order, q.insert]) method.mockReturnValue(q);
  for (const method of [q.range, q.single, q.maybeSingle]) method.mockResolvedValue({ data, error });
  mock.client.mockResolvedValue({ from: vi.fn().mockReturnValue(q) }); return q;
}
beforeEach(() => vi.clearAllMocks());
describe('draft storage queries', () => {
  it('lists branch-shared summaries with authors, stable order, and one lookahead row', async () => {
    const q = query([row, { ...row, id: 'two' }, { ...row, id: 'three' }]); const result = await listDrafts('tenant', 20, 2);
    expect(q.select.mock.calls[0][0]).not.toContain('snapshot'); expect(q.eq.mock.calls).toEqual([['tenant_id', 'tenant'], ['subject', 'english']]);
    expect(q.range).toHaveBeenCalledWith(20, 22); expect(q.order.mock.calls).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(result.items.map(item => item.id)).toEqual(['one', 'two']); expect(result.nextOffset).toBe(22);
    expect(result.items[0]).toMatchObject({ createdBy: 'colleague', createdByName: '저장 강사' });
  });
  it('handles array joins and missing author names without hiding shared drafts', async () => {
    query([{ ...row, author: [{ display_name: '동료 강사' }] }, { ...row, id: 'two', author: null }]);
    const result = await listDrafts('tenant', 0, 20);
    expect(result.items.map(item => item.createdByName)).toEqual(['동료 강사', null]);
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
  const adminQuery = (data: unknown) => {
    const q = { update: vi.fn(), delete: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
    for (const method of [q.update, q.delete, q.eq, q.select]) method.mockReturnValue(q);
    mock.admin.mockReturnValue({ from: vi.fn().mockReturnValue(q) }); return q;
  };
  it('덮어쓰기는 지점·과목·식별자로 좁히고 저장자·시각을 마지막 저장으로 옮긴다', async () => {
    const q = adminQuery(row), draft = snapshot();
    expect((await overwriteDraft('tenant', 'user', 'one', { version: 1, name: '안', snapshot: draft }))?.item.id).toBe('one');
    expect(q.update.mock.calls[0][0]).toMatchObject({ name: '안', created_by: 'user', snapshot: draft, lesson_count: 0, created_at: expect.any(String) });
    expect(q.update.mock.calls[0][0]).not.toHaveProperty('tenant_id');
    expect(q.eq.mock.calls).toEqual([['tenant_id', 'tenant'], ['subject', 'english'], ['id', 'one']]);
  });
  it('삭제도 지점으로 좁히고, 없으면 거짓을 돌려준다', async () => {
    const q = adminQuery({ id: 'one' }); expect(await deleteDraft('tenant', 'one')).toBe(true);
    expect(q.eq.mock.calls).toEqual([['tenant_id', 'tenant'], ['subject', 'english'], ['id', 'one']]);
    adminQuery(null); expect(await deleteDraft('tenant', 'missing')).toBe(false);
  });
  it('덮어쓰기·삭제는 저장한 사람과 영어 과목 관리자 이상만', () => {
    expect(canManageDraft('a', 'a', false)).toBe(true);
    expect(canManageDraft('a', 'b', false)).toBe(false);
    expect(canManageDraft('a', 'b', true)).toBe(true);
  });
  describe('영어 과목 관리자 판정', () => {
    const user = (systemRole: string) => ({ id: 'user', tenantId: 'tenant', systemRole }) as Parameters<typeof managesEnglishDrafts>[0];
    const subjects = (value: string[] | null) => {
      const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { subjects: value }, error: null }) };
      q.select.mockReturnValue(q); q.eq.mockReturnValue(q); mock.admin.mockReturnValue({ from: vi.fn().mockReturnValue(q) });
    };
    beforeEach(() => mock.scope.mockResolvedValue(null));
    it('원장은 늘 된다', async () => { expect(await managesEnglishDrafts(user('master'))).toBe(true); });
    it('강사는 담당 과목이 영어여도 안 된다', async () => { subjects(['english']); expect(await managesEnglishDrafts(user('teacher'))).toBe(false); });
    it.each([['admin', ['english'], true], ['manager', ['english'], true], ['admin', ['math'], false], ['manager', ['math'], false], ['admin', [], true], ['admin', null, true]])('%s · 담당 과목 %j → %s', async (role, value, expected) => {
      subjects(value as string[] | null); expect(await managesEnglishDrafts(user(role as string))).toBe(expected);
    });
    it('특수권한 과목 범위가 담당 과목보다 먼저다', async () => {
      subjects(['english']); mock.scope.mockResolvedValue(['math']); expect(await managesEnglishDrafts(user('admin'))).toBe(false);
      subjects(['math']); mock.scope.mockResolvedValue(['english']); expect(await managesEnglishDrafts(user('admin'))).toBe(true);
    });
  });
  it('validates stored snapshots again on load before they reach the editor', async () => {
    const q = query({ ...row, version: 1, snapshot: snapshot() }); expect((await readDraft('tenant', 'one'))?.snapshot).toEqual(snapshot());
    expect(q.eq.mock.calls).toEqual([['tenant_id', 'tenant'], ['subject', 'english'], ['id', 'one']]);
    query({ ...row, version: 1, snapshot: { bad: 'shape' } }); await expect(readDraft('tenant', 'one')).rejects.toThrow();
    query(null); expect(await readDraft('tenant', 'missing')).toBeNull();
  });
  it('does not turn database errors into an empty list or missing draft', async () => {
    query(null, new Error('failed')); await expect(listDrafts('tenant', 0, 20)).rejects.toThrow('failed');
    await expect(readDraft('tenant', 'one')).rejects.toThrow('failed');
  });
});
