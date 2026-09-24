import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeUserRole, toggleTenantLicense, upsertTenantLicense } from "./actions";

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn().mockResolvedValue({ id: "super-admin", email: "admin@example.test" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

function fields(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

beforeEach(() => createAdminClient.mockReset());

describe("superadmin mutation boundaries", () => {
  it.each(["super_admin", "student", "unknown"])("rejects unsupported user role %s before admin DB access", async (role) => {
    const result = await changeUserRole(undefined, fields({ userId: "user", tenantId: "tenant", role }));
    expect(result?.error).toBe("지원하지 않는 역할입니다");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects arbitrary license feature names before admin DB access", async () => {
    const form = fields({ tenantId: "tenant", feature: "admin_access", maxSeats: "1" });
    expect((await upsertTenantLicense(undefined, form))?.error).toBe("지원하지 않는 좌석 기능입니다");
    expect((await toggleTenantLicense(undefined, form))?.error).toBe("지원하지 않는 기능입니다");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects fractional and unsafe seat counts", async () => {
    for (const maxSeats of ["1.5", "9007199254740992"]) {
      const result = await upsertTenantLicense(undefined, fields({ tenantId: "tenant", feature: "student_seats", maxSeats }));
      expect(result?.error).toBe("좌석 수가 올바르지 않습니다");
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
