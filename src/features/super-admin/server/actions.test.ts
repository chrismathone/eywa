import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeUserRole, toggleTenantLicense, upsertTenantLicense } from "./actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  acquireLease: vi.fn(),
  closePending: vi.fn(),
  releaseLease: vi.fn(),
  resetWindows: vi.fn(),
  transition: vi.fn(),
  logAction: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn().mockResolvedValue({ id: "super-admin", email: "admin@example.test" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/features/slack/server/license-transition", () => ({
  acquireSlackMaintenanceLease: mocks.acquireLease,
  closePendingSlackWork: mocks.closePending,
  releaseSlackMaintenanceLease: mocks.releaseLease,
  resetEnabledRuleWindows: mocks.resetWindows,
  slackLicenseTransition: mocks.transition,
}));
vi.mock("./audit", () => ({ logSuperAdminAction: mocks.logAction }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
}));

function fields(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function licenseAdmin(previous: { is_active: boolean; expires_at: string | null } | null, updatedAt = "2026-11-12T03:00:00.000Z") {
  const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  read.select.mockReturnValue(read);
  read.eq.mockReturnValue(read);
  read.maybeSingle.mockResolvedValue({ data: previous, error: null });

  const save = { upsert: vi.fn(), select: vi.fn(), single: vi.fn() };
  save.upsert.mockReturnValue(save);
  save.select.mockReturnValue(save);
  save.single.mockResolvedValue({ data: { updated_at: updatedAt }, error: null });

  let calls = 0;
  const admin = {
    from: vi.fn((table: string) => {
      if (table !== "tenant_licenses") throw new Error(`예상하지 않은 표: ${table}`);
      return calls++ === 0 ? read : save;
    }),
  };
  return { admin, save };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transition.mockImplementation((previousOn: boolean, nextOn: boolean) =>
    previousOn === nextOn ? "unchanged" : nextOn ? "enable" : "disable",
  );
  mocks.acquireLease.mockResolvedValue({ leaseId: "lease" });
  mocks.closePending.mockResolvedValue({ inboxSkipped: 2, outboxCancelled: 3 });
  mocks.resetWindows.mockResolvedValue({ rulesReset: 4 });
  mocks.releaseLease.mockResolvedValue(undefined);
  mocks.logAction.mockResolvedValue(undefined);
});

describe("superadmin mutation boundaries", () => {
  it.each(["super_admin", "student", "unknown"])("rejects unsupported user role %s before admin DB access", async (role) => {
    const result = await changeUserRole(undefined, fields({ userId: "user", tenantId: "tenant", role }));
    expect(result?.error).toBe("지원하지 않는 역할입니다");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects arbitrary license feature names before admin DB access", async () => {
    const form = fields({ tenantId: "tenant", feature: "admin_access", maxSeats: "1" });
    expect((await upsertTenantLicense(undefined, form))?.error).toBe("지원하지 않는 좌석 기능입니다");
    expect((await toggleTenantLicense(undefined, form))?.error).toBe("지원하지 않는 기능입니다");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects fractional and unsafe seat counts", async () => {
    for (const maxSeats of ["1.5", "9007199254740992"]) {
      const result = await upsertTenantLicense(undefined, fields({ tenantId: "tenant", feature: "student_seats", maxSeats }));
      expect(result?.error).toBe("좌석 수가 올바르지 않습니다");
    }
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("슬랙을 켤 때 옛 대기를 닫은 뒤 저장 시각으로 규칙 시작 시각을 재설정한다", async () => {
    const { admin, save } = licenseAdmin(null);
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await toggleTenantLicense(undefined, fields({
      tenantId: "tenant",
      tenantName: "테스트 지점",
      feature: "slack",
      nextActive: "true",
    }));

    expect(result).toEqual({ ok: true });
    expect(mocks.acquireLease).toHaveBeenCalledWith("tenant", expect.any(Date));
    expect(mocks.closePending).toHaveBeenCalledWith("tenant", expect.any(String));
    expect(save.upsert).toHaveBeenCalledWith(
      { tenant_id: "tenant", feature: "slack", is_active: true, expires_at: null },
      { onConflict: "tenant_id,feature" },
    );
    expect(mocks.resetWindows).toHaveBeenCalledWith("tenant", "2026-11-12T03:00:00.000Z");
    expect(mocks.closePending.mock.invocationCallOrder[0]).toBeLessThan(mocks.resetWindows.mock.invocationCallOrder[0]);
    expect(mocks.releaseLease).toHaveBeenCalledWith("tenant", "lease");
  });

  it("침산처럼 슬랙이 켜진 채면 전환 정리와 규칙 시작 시각 재설정을 하지 않는다", async () => {
    const { admin } = licenseAdmin({ is_active: true, expires_at: null });
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await toggleTenantLicense(undefined, fields({
      tenantId: "cs",
      tenantName: "인재원 침산",
      feature: "slack",
      nextActive: "true",
    }));

    expect(result).toEqual({ ok: true });
    expect(mocks.transition).toHaveBeenCalledWith(true, true);
    expect(mocks.acquireLease).not.toHaveBeenCalled();
    expect(mocks.closePending).not.toHaveBeenCalled();
    expect(mocks.resetWindows).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
  });

  it("슬랙 끄기 정리가 실패해도 꺼진 사실과 다음 켜기 전 정리를 안내한다", async () => {
    const { admin } = licenseAdmin({ is_active: true, expires_at: null });
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.closePending.mockResolvedValue({
      inboxSkipped: 2,
      outboxCancelled: 0,
      error: "슬랙 발송 대기를 정리하지 못했습니다",
    });

    const result = await toggleTenantLicense(undefined, fields({
      tenantId: "tenant",
      feature: "slack",
      nextActive: "false",
    }));

    expect(result).toEqual({
      error: "슬랙은 꺼졌습니다. 슬랙 발송 대기를 정리하지 못했습니다. 남은 발송 대기는 다시 켜기 전에 정리됩니다",
    });
    expect(mocks.resetWindows).not.toHaveBeenCalled();
  });
});
