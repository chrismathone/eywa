import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentSuperAdmin } from "@/lib/auth/super-admin";
import AdminRedirect from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/super-admin", () => ({ getCurrentSuperAdmin: vi.fn() }));

describe("/admin entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentSuperAdmin).mockResolvedValue(null);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
  });

  it("routes a pure super admin without a tenant user row to all branches", async () => {
    vi.mocked(getCurrentSuperAdmin).mockResolvedValue({ id: "sa", email: "sa@example.com", displayName: "SA" });
    await expect(AdminRedirect()).rejects.toThrow("redirect:/super-admin/tenants");
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("allows an existing branch super admin to enter /admin directly", async () => {
    vi.mocked(getCurrentSuperAdmin).mockResolvedValue({ id: "branch-sa", email: "st2000423@gmail.com", displayName: "Branch SA" });
    await expect(AdminRedirect()).rejects.toThrow("redirect:/super-admin/tenants");
  });

  it("preserves the academy admin path for other signed-in users", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", tenantId: "t", email: "u@example.com", displayName: "U", jobTitle: null, systemRole: "master" });
    await expect(AdminRedirect()).rejects.toThrow("redirect:/owner?tab=data");
  });

  it("sends anonymous visitors to login", async () => {
    await expect(AdminRedirect()).rejects.toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
