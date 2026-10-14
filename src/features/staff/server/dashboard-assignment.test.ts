import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), superAdmin: false }));
const id = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "tenant-a", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => m.superAdmin }));
vi.mock("@/lib/auth/protected-accounts", () => ({ protectionStatus: m.status }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ dashboard: { version: 1, layouts: [], assignments: [] }, operations: { subjects: [] } }) }));
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: m.save }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = { select: () => query, eq: () => query, neq: () => query, maybeSingle: async () => ({ data: { id, system_role: "admin" }, error: null }) };
  return query;
} }) }));
import { saveStaffDashboardAssignment } from "./dashboard-assignment";
const input = { userId: id, scope: "all", subjects: [], adminLayout: "desk" };
beforeEach(() => { vi.clearAllMocks(); m.superAdmin = false; m.status.mockResolvedValue("clear"); m.save.mockResolvedValue({ ok: true }); });

describe("직원관리 대시보드 배정의 지점 경계", () => {
  it.each([false, true])("운영자 계정은 지점에서 배정하지 않는다 (행위자 운영자: %s)", async (isSuper) => {
    m.superAdmin = isSuper; m.status.mockResolvedValue("protected");
    expect(await saveStaffDashboardAssignment(input)).toMatchObject({ error: expect.stringContaining("지점에서 변경할 수 없습니다") });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("보호 여부를 모르면 저장하지 않는다", async () => {
    m.status.mockResolvedValue("unknown");
    expect(await saveStaffDashboardAssignment(input)).toMatchObject({ error: expect.stringContaining("확인하지 못했습니다") });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("일반 지점 직원의 배정은 기존 저장 경로로 전달한다", async () => {
    expect(await saveStaffDashboardAssignment(input)).toEqual({ ok: true });
    expect(m.save).toHaveBeenCalledOnce();
  });
});
