import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), manage: vi.fn(), read: vi.fn(), log: vi.fn() }));
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/auth/perm-matrix', () => ({ canManageTenant: mocks.manage }));
vi.mock('@/features/timetable-lab/server/source', () => ({ readLabSource: mocks.read }));
vi.mock('@/lib/supabase/db-error', () => ({ logDbError: mocks.log }));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ tenantId: 'own-tenant', systemRole: 'admin' });
  mocks.manage.mockResolvedValue(true); mocks.read.mockResolvedValue({ version: 1 });
});
describe('timetable source read authorization', () => {
  it('returns 401 before any source or permission read when not logged in', async () => {
    mocks.user.mockResolvedValue(null); const response = await GET(new Request('http://localhost/api/timetable/lab/source'));
    expect(response.status).toBe(401); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.manage).not.toHaveBeenCalled();
  });
  it.each(['timetable', 'classes'])('requires full %s permission', async denied => {
    mocks.manage.mockImplementation(async (_role, scope) => scope !== denied);
    expect((await GET(new Request('http://localhost/api/timetable/lab/source'))).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('takes tenant only from the session and returns uncached private data for the selected week', async () => {
    const response = await GET(new Request('http://localhost/api/timetable/lab/source?date=2026-10-02&tenantId=other'));
    expect(response.status).toBe(200); expect(mocks.read).toHaveBeenCalledWith('own-tenant', '2026-09-28');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(response.headers.get('Vary')).toBe('Cookie');
  });
  it.each(['2026-02-30', 'hello', '2026-13-01'])('rejects invalid date %s before reading', async date => {
    expect((await GET(new Request(`http://localhost/api/timetable/lab/source?date=${date}`))).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('reports a source failure without leaking database messages or replacing a draft', async () => {
    mocks.read.mockRejectedValue(new Error('private SQL details')); const response = await GET(new Request('http://localhost/api/timetable/lab/source'));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private SQL'); expect(mocks.log).toHaveBeenCalled();
  });
});
