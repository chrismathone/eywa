import { beforeEach, describe, expect, it, vi } from "vitest";
const { currentUser, billingAccess } = vi.hoisted(() => ({ currentUser: vi.fn(), billingAccess: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: billingAccess }));
import { analyticsAccess } from "./access";

describe("analytics administrator boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); billingAccess.mockResolvedValue(true); });
  it("requires a session", async () => {
    currentUser.mockResolvedValue(null);
    expect(await analyticsAccess()).toEqual({ ok: false, status: 401 });
    expect(billingAccess).not.toHaveBeenCalled();
  });
  it.each(["master", "admin"])("allows %s with billing access", async (systemRole) => {
    currentUser.mockResolvedValue({ id: "actor", tenantId: "tenant-a", systemRole });
    expect(await analyticsAccess()).toMatchObject({ ok: true });
    expect(currentUser).toHaveBeenCalledWith({ teacherView: true });
  });
  it.each(["manager", "teacher", "counselor", "accountant", "viewer", "student"])("blocks %s even with delegated billing access", async (systemRole) => {
    currentUser.mockResolvedValue({ id: "actor", tenantId: "tenant-a", systemRole });
    expect(await analyticsAccess()).toEqual({ ok: false, status: 403 });
    expect(billingAccess).not.toHaveBeenCalled();
  });
  it("respects revoked menu access", async () => {
    currentUser.mockResolvedValue({ id: "actor", tenantId: "tenant-a", systemRole: "admin" });
    billingAccess.mockResolvedValue(false);
    expect(await analyticsAccess()).toEqual({ ok: false, status: 403 });
  });
  it("blocks cross-tenant viewing and missing tenant context", async () => {
    for (const user of [
      { tenantId: "b", systemRole: "master", tenantView: { tenantId: "b" } },
      { tenantId: "", systemRole: "master" },
    ]) {
      currentUser.mockResolvedValue(user);
      expect(await analyticsAccess()).toEqual({ ok: false, status: 403 });
    }
  });
});
