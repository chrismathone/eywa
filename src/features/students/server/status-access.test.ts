import { beforeEach, describe, expect, it, vi } from "vitest";
import { canManageStudentStatusNow, canManageAdministrativeStudentStatusNow } from "./status-access";

const m = vi.hoisted(() => ({ user: vi.fn(), privileged: vi.fn(), readonly: vi.fn(), tenant: vi.fn(), full: vi.fn(), settings: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.privileged }));
vi.mock("@/lib/auth/view-mode", () => ({ isReadonlyTeacherView: m.readonly }));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewWriteBlocked: m.tenant }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: m.full }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
const A = "11111111-1111-4111-8111-111111111111";
const settings = (specialAccess: unknown) => m.settings.mockResolvedValue({ permissions: { specialAccess } });
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ id: A, tenantId: "tenant", systemRole: "admin" });
  m.privileged.mockResolvedValue(false); m.readonly.mockResolvedValue(false); m.tenant.mockResolvedValue(false); m.full.mockResolvedValue(true);
  settings({ studentStatusManagerIds: [] });
});
describe("student status server gate", () => {
  it("legacy retains office operators; explicit empty and invalid values revoke", async () => {
    settings({}); expect(await canManageStudentStatusNow()).toBe(true);
    for (const value of [[], null, [A, 7], [A, A]]) { settings({ studentStatusManagerIds: value }); expect(await canManageStudentStatusNow()).toBe(false); }
    settings({ studentStatusManagerIds: [A] }); expect(await canManageStudentStatusNow()).toBe(true);
  });
  it("assignment cannot widen menu, module, or office role restrictions", async () => {
    settings({ studentStatusManagerIds: [A] }); m.full.mockResolvedValue(false); expect(await canManageStudentStatusNow()).toBe(false);
    m.full.mockResolvedValue(true);
    for (const systemRole of ["teacher", "viewer", "student"]) {
      m.user.mockResolvedValue({ id: A, systemRole }); expect(await canManageStudentStatusNow()).toBe(false);
    }
  });
  it("owner and protected identities retain authority after readonly caps", async () => {
    m.user.mockResolvedValue({ id: A, systemRole: "master" }); expect(await canManageStudentStatusNow()).toBe(true);
    m.privileged.mockResolvedValue(true); m.readonly.mockResolvedValue(true); expect(await canManageStudentStatusNow()).toBe(false);
    m.readonly.mockResolvedValue(false); m.tenant.mockResolvedValue(true); expect(await canManageStudentStatusNow()).toBe(false);
  });
  it("teacher view: the manager list and owner role are judged for the validated target, not the real account (2026-11-05)", async () => {
    const X = "22222222-2222-4222-8222-222222222222";
    // '다른 강사 뷰'로 X를 열면 getCurrentUser({ teacherView: true })가 X를 준다 — 실제 계정 A는 옵션 없이 부를 때만.
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? { id: X, systemRole: "manager" } : { id: A, systemRole: "master" }));
    settings({ studentStatusManagerIds: [X] }); expect(await canManageStudentStatusNow()).toBe(true);
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    // 실제 계정이 원장이어도 대상 X가 명단에 없으면 열지 않는다.
    settings({ studentStatusManagerIds: [A] }); expect(await canManageStudentStatusNow()).toBe(false);
  });
  it("maintenance keeps its existing legacy menu contract, then requires explicit status authority", async () => {
    settings({}); m.full.mockResolvedValue(false); expect(await canManageAdministrativeStudentStatusNow()).toBe(true);
    settings({ studentStatusManagerIds: [] }); expect(await canManageAdministrativeStudentStatusNow()).toBe(false);
  });
});
