// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), manage: vi.fn(), list: vi.fn(), create: vi.fn(), read: vi.fn(), target: vi.fn(), overwrite: vi.fn(), remove: vi.fn(), subjectManager: vi.fn(), log: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/auth/perm-matrix', () => ({ canManageTenant: mocks.manage }));
vi.mock('@/features/timetable-lab/server/drafts', () => ({ listDrafts: mocks.list, createDraft: mocks.create, readDraft: mocks.read, readDraftTarget: mocks.target, overwriteDraft: mocks.overwrite, deleteDraft: mocks.remove,
  managesEnglishDrafts: mocks.subjectManager, canManageDraft: (userId: string, createdBy: string, subjectManager: boolean) => createdBy === userId || subjectManager }));
vi.mock('@/lib/supabase/db-error', () => ({ logDbError: mocks.log }));
vi.mock('@/features/audit/server/log', () => ({ logAction: mocks.audit }));
import { GET, POST } from './route';
import { DELETE as remove, GET as read, PUT as overwrite } from './[id]/route';
import { MAX_DRAFT_BYTES } from '@/features/timetable-lab/draft-schema';
const tenantId = '10000000-0000-4000-8000-000000000001', userId = '20000000-0000-4000-8000-000000000001';
const draftId = '30000000-0000-4000-8000-000000000001';
const url = 'http://localhost/api/timetable/lab/drafts';
const snapshot = () => ({ cells: [Array.from({ length: 6 }, () => ({ text: '' }))], placements: [], students: {} });
const input = () => ({ version: 1, name: '11월 첫 연습본', snapshot: snapshot() });
const post = (value: unknown = input(), headers = {}) => new Request(url, { method: 'POST', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json', ...headers } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: userId, tenantId, systemRole: 'admin' });
  mocks.manage.mockResolvedValue(true); mocks.list.mockResolvedValue({ items: [], nextOffset: null });
  mocks.create.mockResolvedValue({ item: { id: draftId, name: '11월 첫 연습본', lessonCount: 2, classCount: 1, studentCount: 3, referenceDate: null } }); mocks.read.mockResolvedValue({ version: 1, snapshot: snapshot() });
});
describe('저장본 덮어쓰기·삭제', () => {
  const params = { params: Promise.resolve({ id: draftId }) }, other = '20000000-0000-4000-8000-000000000002';
  const target = (createdBy: string) => ({ id: draftId, name: '옛 이름', createdBy, createdByName: '저장 강사', createdAt: '2026-10-22T06:00:00Z', lessonCount: 9, classCount: 3, studentCount: 7, referenceDate: null });
  const put = (value: unknown = input()) => new Request(`${url}/${draftId}`, { method: 'PUT', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } });
  const del = (headers = {}) => new Request(`${url}/${draftId}`, { method: 'DELETE', headers });
  beforeEach(() => {
    mocks.target.mockResolvedValue(target(userId)); mocks.remove.mockResolvedValue(true); mocks.subjectManager.mockResolvedValue(false);
    mocks.overwrite.mockResolvedValue({ item: { id: draftId, name: '11월 첫 연습본', lessonCount: 2, classCount: 1, studentCount: 3, referenceDate: null } });
  });
  it('저장한 사람은 덮어쓰고, 이전 저장자·규모를 감사로그에 남긴다', async () => {
    const response = await overwrite(put(), params);
    expect(response.status).toBe(200); expect((await response.json()).item.manageable).toBe(true);
    expect(mocks.overwrite).toHaveBeenCalledWith(tenantId, userId, draftId, input());
    expect(mocks.audit).toHaveBeenCalledWith({ action: 'timetable_lab_draft_overwrite', targetType: 'timetable_lab_draft', targetLabel: '11월 첫 연습본',
      metadata: { draftId, lessonCount: 2, classCount: 1, studentCount: 3, referenceDate: null, previous: { name: '옛 이름', savedBy: '저장 강사', savedAt: '2026-10-22T06:00:00Z', lessonCount: 9 } } });
  });
  it('저장한 사람은 삭제하고 감사로그에 남긴다', async () => {
    expect((await remove(del(), params)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(tenantId, draftId);
    expect(mocks.audit).toHaveBeenCalledWith({ action: 'timetable_lab_draft_delete', targetType: 'timetable_lab_draft', targetLabel: '옛 이름',
      metadata: { draftId, lessonCount: 9, classCount: 3, studentCount: 7, referenceDate: null, savedBy: '저장 강사', savedAt: '2026-10-22T06:00:00Z' } });
  });
  it('🔴 남의 저장본은 덮어쓰거나 지울 수 없다 — 쓰기·감사로그 모두 없다', async () => {
    mocks.target.mockResolvedValue(target(other));
    expect((await overwrite(put(), params)).status).toBe(403); expect((await remove(del(), params)).status).toBe(403);
    expect(mocks.overwrite).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('영어 과목 관리자 이상은 남의 저장본도 덮어쓰고 지울 수 있다', async () => {
    mocks.subjectManager.mockResolvedValue(true); mocks.target.mockResolvedValue(target(other));
    expect((await overwrite(put(), params)).status).toBe(200); expect((await remove(del(), params)).status).toBe(200);
    expect(mocks.subjectManager).toHaveBeenCalledWith(expect.objectContaining({ id: userId, tenantId }));
  });
  it('다른 지점·없는 저장본은 404이고 쓰지 않는다', async () => {
    mocks.target.mockResolvedValue(null);
    expect((await overwrite(put(), params)).status).toBe(404); expect((await remove(del(), params)).status).toBe(404);
    expect(mocks.target).toHaveBeenCalledWith(tenantId, draftId); expect(mocks.overwrite).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('로그인·권한·교차 사이트 요청을 거절한다', async () => {
    expect((await remove(del({ 'Sec-Fetch-Site': 'cross-site' }), params)).status).toBe(403);
    mocks.manage.mockResolvedValue(false);
    expect((await overwrite(put(), params)).status).toBe(403); expect((await remove(del(), params)).status).toBe(403);
    mocks.user.mockResolvedValue(null);
    expect((await overwrite(put(), params)).status).toBe(401); expect((await remove(del(), params)).status).toBe(401);
    expect(mocks.overwrite).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('목록은 계정별로 덮어쓸 수 있는 저장본을 표시한다', async () => {
    mocks.list.mockResolvedValue({ items: [target(userId), target(other)], nextOffset: null });
    const body = await (await GET(new Request(url))).json();
    expect(body.items.map((item: { manageable: boolean }) => item.manageable)).toEqual([true, false]);
    mocks.subjectManager.mockResolvedValue(true);
    const manager = await (await GET(new Request(url))).json();
    expect(manager.items.map((item: { manageable: boolean }) => item.manageable)).toEqual([true, true]);
  });
  it('저장 실패는 감사로그를 남기지 않는다', async () => {
    mocks.overwrite.mockRejectedValue(new Error('failed'));
    expect((await overwrite(put(), params)).status).toBe(503); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
describe('branch-shared timetable draft API', () => {
  it.each(['list', 'create', 'read'])('requires login for %s before queries', async action => {
    mocks.user.mockResolvedValue(null);
    const response = action === 'list' ? await GET(new Request(url)) : action === 'create' ? await POST(post()) : await read(new Request(url), { params: Promise.resolve({ id: draftId }) });
    expect(response.status).toBe(401); expect(mocks.manage).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['timetable', 'classes'])('requires full %s rights for both reads and writes', async denied => {
    mocks.manage.mockImplementation(async (_role, scope) => scope !== denied);
    expect((await GET(new Request(url))).status).toBe(403); expect((await POST(post())).status).toBe(403);
    expect((await read(new Request(url), { params: Promise.resolve({ id: draftId }) })).status).toBe(403);
  });
  it('bounds pagination and takes ownership only from the session', async () => {
    const response = await GET(new Request(`${url}?offset=20&limit=10&tenantId=other&createdBy=other`));
    expect(mocks.list).toHaveBeenCalledWith(tenantId, 20, 10); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    for (const query of ['offset=-1', 'offset=100001', 'offset=1.1', 'offset=Infinity', 'limit=51', 'limit=0', 'limit=abc']) {
      expect((await GET(new Request(`${url}?${query}`))).status).toBe(400);
    }
  });
  it('creates a new snapshot and rejects ownership fields instead of trusting them', async () => {
    expect((await POST(post())).status).toBe(201); expect(mocks.create).toHaveBeenCalledWith(tenantId, userId, input());
    expect((await POST(post({ ...input(), createdBy: 'other' }))).status).toBe(400);
    // 저장된 한 번만 감사로그에 남는다 — 이름은 대상 칸, 규모는 상세. 시간표 내용은 싣지 않는다.
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith({ action: 'timetable_lab_draft_save', targetType: 'timetable_lab_draft', targetLabel: '11월 첫 연습본',
      metadata: { draftId, lessonCount: 2, classCount: 1, studentCount: 3, referenceDate: null } });
  });
  it('refuses a snapshot imported from another branch', async () => {
    const value = input(); const source = { kind: 'live', date: '2026-10-02', tenantId: '10000000-0000-4000-8000-000000000002',
      loadedAt: '2026-10-02T00:00:00Z', academy: '', notices: [], step: 10, teacherOrder: [] };
    expect((await POST(post({ ...value, snapshot: { ...value.snapshot, source } }))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects oversized, malformed and cross-site bodies before persistence', async () => {
    expect((await POST(post({ ...input(), name: 'x'.repeat(MAX_DRAFT_BYTES) }))).status).toBe(413);
    expect((await POST(new Request(url, { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }))).status).toBe(400);
    expect((await POST(post(input(), { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await POST(post(input(), { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('loads a saved UUID from the current branch and hides missing/foreign snapshots behind 404', async () => {
    expect((await read(new Request(url), { params: Promise.resolve({ id: draftId }) })).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(tenantId, draftId);
    expect((await read(new Request(url), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400);
    mocks.read.mockResolvedValue(null); expect((await read(new Request(url), { params: Promise.resolve({ id: draftId }) })).status).toBe(404);
  });
  it('returns a safe failure without losing the current draft or leaking DB diagnostics', async () => {
    mocks.create.mockRejectedValue(new Error('private SQL details')); const response = await POST(post());
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private SQL'); expect(mocks.log).toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
