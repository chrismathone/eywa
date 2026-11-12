import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_TENANT_LICENSE_OPTIONS, type NewTenantLicenseSelection } from "../new-tenant-licenses";
import {
  changeUserRole,
  createTenantWithMaster,
  setTenantWindowMode,
  toggleTenantLicense,
  upsertTenantLicense,
} from "./actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  logSuperAdminAction: vi.fn(),
  redirect: vi.fn(),
  acquireLease: vi.fn(),
  closePending: vi.fn(),
  releaseLease: vi.fn(),
  resetWindows: vi.fn(),
  transition: vi.fn(),
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
vi.mock("./audit", () => ({ logSuperAdminAction: mocks.logSuperAdminAction }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  updateTag: mocks.updateTag,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

function fields(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function tenantForm(selection?: NewTenantLicenseSelection) {
  const form = fields({
    slug: "new-branch",
    name: "폼 학원",
    masterEmail: "owner@example.test",
    masterPassword: "password123",
    displayName: "새 원장",
    plan: "pro",
  });
  if (selection) {
    for (const { key } of NEW_TENANT_LICENSE_OPTIONS) {
      form.append(key, "false");
      if (selection[key]) form.append(key, "true");
    }
  }
  return form;
}

function creationAdmin({
  settingsError = null,
  licensesError = null,
  authError = null,
  rollbackError = null,
}: {
  settingsError?: { code?: string; message: string } | null;
  licensesError?: { code?: string; message: string } | null;
  authError?: { code?: string; message: string } | null;
  rollbackError?: { code?: string; message: string } | null;
} = {}) {
  const tenantId = "tenant-new";
  const tenantInsertSingle = vi.fn().mockResolvedValue({ data: { id: tenantId, name: "DB 학원" }, error: null });
  const tenantInsertSelect = vi.fn().mockReturnValue({ single: tenantInsertSingle });
  const tenantInsert = vi.fn().mockReturnValue({ select: tenantInsertSelect });
  const rollbackMaybeSingle = vi.fn().mockResolvedValue({
    data: rollbackError ? null : { id: tenantId },
    error: rollbackError,
  });
  const rollbackSelect = vi.fn().mockReturnValue({ maybeSingle: rollbackMaybeSingle });
  const rollbackEq = vi.fn().mockReturnValue({ select: rollbackSelect });
  const tenantDelete = vi.fn().mockReturnValue({ eq: rollbackEq });
  const settingsInsert = vi.fn().mockResolvedValue({ error: settingsError });
  const licensesInsert = vi.fn().mockResolvedValue({ error: licensesError });
  const userSecondEq = vi.fn().mockResolvedValue({ error: null });
  const userFirstEq = vi.fn().mockReturnValue({ eq: userSecondEq });
  const userUpdate = vi.fn().mockReturnValue({ eq: userFirstEq });
  const createUser = vi.fn().mockResolvedValue({ error: authError });
  const from = vi.fn((table: string) => {
    if (table === "tenants") return { insert: tenantInsert, delete: tenantDelete };
    if (table === "tenant_settings") return { insert: settingsInsert };
    if (table === "tenant_licenses") return { insert: licensesInsert };
    if (table === "users") return { update: userUpdate };
    throw new Error(`예상하지 못한 표: ${table}`);
  });
  return {
    admin: { from, auth: { admin: { createUser } } },
    spies: { createUser, licensesInsert, rollbackMaybeSingle, settingsInsert, tenantDelete },
  };
}

function licenseMutationAdmin() {
  const tenantMaybeSingle = vi.fn().mockResolvedValue({ data: { name: "DB 학원" }, error: null });
  const tenantEq = vi.fn().mockReturnValue({ maybeSingle: tenantMaybeSingle });
  const tenantSelect = vi.fn().mockReturnValue({ eq: tenantEq });
  const licenseSingle = vi.fn().mockResolvedValue({ data: { updated_at: "2026-11-12T03:00:00.000Z" }, error: null });
  // 좌석·화면 방식은 upsert를 바로 기다리고, 기능 켜고 끄기는 저장 시각까지 읽는다(.select().single()).
  const licenseUpsert = vi.fn(() =>
    Object.assign(Promise.resolve({ error: null }), { select: vi.fn(() => ({ single: licenseSingle })) }),
  );
  const from = vi.fn((table: string) => {
    if (table === "tenants") return { select: tenantSelect };
    if (table === "tenant_licenses") return { upsert: licenseUpsert };
    throw new Error(`예상하지 못한 표: ${table}`);
  });
  return { admin: { from }, licenseUpsert };
}

function licenseAdmin(previous: { is_active: boolean; expires_at: string | null } | null, updatedAt = "2026-11-12T03:00:00.000Z") {
  const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  read.select.mockReturnValue(read);
  read.eq.mockReturnValue(read);
  read.maybeSingle.mockResolvedValue({ data: previous, error: null });
  // 감사 기록의 학원 이름은 서버가 tenants에서 읽는다(폼 이름 무시).
  const tenant = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  tenant.select.mockReturnValue(tenant);
  tenant.eq.mockReturnValue(tenant);
  tenant.maybeSingle.mockResolvedValue({ data: { name: "DB 학원" }, error: null });

  const save = { upsert: vi.fn(), select: vi.fn(), single: vi.fn() };
  save.upsert.mockReturnValue(save);
  save.select.mockReturnValue(save);
  save.single.mockResolvedValue({ data: { updated_at: updatedAt }, error: null });

  let calls = 0;
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "tenants") return tenant;
      if (table !== "tenant_licenses") throw new Error(`예상하지 않은 표: ${table}`);
      return calls++ === 0 ? read : save;
    }),
  };
  return { admin, save };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.transition.mockImplementation((previousOn: boolean, nextOn: boolean) =>
    previousOn === nextOn ? "unchanged" : nextOn ? "enable" : "disable",
  );
  mocks.acquireLease.mockResolvedValue({ leaseId: "lease" });
  mocks.closePending.mockResolvedValue({ inboxSkipped: 2, outboxCancelled: 3 });
  mocks.resetWindows.mockResolvedValue({ rulesReset: 4 });
  mocks.releaseLease.mockResolvedValue(undefined);
  mocks.logSuperAdminAction.mockResolvedValue(undefined);
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

const LICENSE_COMBINATIONS: NewTenantLicenseSelection[] = Array.from({ length: 8 }, (_, mask) => ({
  ai_analysis: Boolean(mask & 1),
  meeting_recording: Boolean(mask & 2),
  google_sheets: Boolean(mask & 4),
}));

describe("새 학원 기능 라이선스", () => {
  it.each(LICENSE_COMBINATIONS)("세 기능 조합을 모두 명시 행으로 만든다: %#", async (selection) => {
    const { admin, spies } = creationAdmin();
    mocks.createAdminClient.mockReturnValue(admin);

    await createTenantWithMaster(undefined, tenantForm(selection));

    expect(spies.licensesInsert).toHaveBeenCalledWith(
      NEW_TENANT_LICENSE_OPTIONS.map(({ key }) => ({
        tenant_id: "tenant-new",
        feature: key,
        is_active: selection[key],
        expires_at: null,
      })),
    );
    expect(mocks.logSuperAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "create_tenant",
      targetLabel: "DB 학원",
      metadata: expect.objectContaining(selection),
    }));
  });

  it("배포 중 옛 화면이 세 필드를 보내지 않아도 권장 기본값의 명시 행을 만든다", async () => {
    const { admin, spies } = creationAdmin();
    mocks.createAdminClient.mockReturnValue(admin);

    await createTenantWithMaster(undefined, tenantForm());

    expect(spies.licensesInsert).toHaveBeenCalledWith([
      { tenant_id: "tenant-new", feature: "ai_analysis", is_active: true, expires_at: null },
      { tenant_id: "tenant-new", feature: "meeting_recording", is_active: false, expires_at: null },
      { tenant_id: "tenant-new", feature: "google_sheets", is_active: false, expires_at: null },
    ]);
  });

  it("기능 행 생성이 실패하면 계정을 만들지 않고 학원 삭제 결과까지 확인한다", async () => {
    const { admin, spies } = creationAdmin({ licensesError: { code: "57014", message: "timeout" } });
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await createTenantWithMaster(undefined, tenantForm());

    expect(result?.error).toContain("처리 시간이 초과되었습니다");
    expect(spies.tenantDelete).toHaveBeenCalledOnce();
    expect(spies.rollbackMaybeSingle).toHaveBeenCalledOnce();
    expect(spies.createUser).not.toHaveBeenCalled();
  });

  it.each([
    { step: "설정", errors: { settingsError: { message: "settings failed" } } },
    { step: "기능", errors: { licensesError: { message: "licenses failed" } } },
    { step: "계정", errors: { authError: { message: "auth failed" } } },
  ])("$step 생성 실패 뒤 학원 삭제까지 실패하면 복구 실패를 알린다", async ({ errors }) => {
    const { admin } = creationAdmin({ ...errors, rollbackError: { message: "delete failed" } });
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await createTenantWithMaster(undefined, tenantForm());

    expect(result?.error).toContain("되돌리지 못했습니다");
  });
});

describe("라이선스 감사 로그 학원 이름", () => {
  it.each([
    {
      label: "좌석",
      run: () => upsertTenantLicense(undefined, fields({ tenantId: "tenant", tenantName: "위조 이름", feature: "student_seats", maxSeats: "10" })),
    },
    {
      label: "화면 방식",
      run: () => setTenantWindowMode(undefined, fields({ tenantId: "tenant", tenantName: "위조 이름", mode: "single" })),
    },
    {
      label: "기능",
      run: () => toggleTenantLicense(undefined, fields({ tenantId: "tenant", tenantName: "위조 이름", feature: "ai_analysis", nextActive: "false" })),
    },
  ])("$label 변경은 폼 이름을 무시하고 서버가 읽은 이름을 기록한다", async ({ run }) => {
    const { admin } = licenseMutationAdmin();
    mocks.createAdminClient.mockReturnValue(admin);

    expect(await run()).toEqual({ ok: true });
    expect(mocks.logSuperAdminAction).toHaveBeenCalledWith(expect.objectContaining({ targetLabel: "DB 학원" }));
  });
});
