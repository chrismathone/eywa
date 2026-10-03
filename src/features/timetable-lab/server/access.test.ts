import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/perm-matrix', () => ({ canManageTenant: mocks.manage }));
import { canUseTimetableEditor } from './access';

beforeEach(() => { vi.clearAllMocks(); mocks.manage.mockResolvedValue(true); });
describe('시간표 편집기를 쓸 수 있는가', () => {
  it('시간표와 반을 모두 관리할 수 있어야 한다', async () => {
    expect(await canUseTimetableEditor('admin')).toBe(true);
    expect(mocks.manage.mock.calls.map(call => call[1]).sort()).toEqual(['classes', 'timetable']);
  });
  it.each(['timetable', 'classes'])('%s 관리 권한이 없으면 쓸 수 없다', async denied => {
    mocks.manage.mockImplementation(async (_role: string, menu: string) => menu !== denied);
    expect(await canUseTimetableEditor('teacher')).toBe(false);
  });
});
