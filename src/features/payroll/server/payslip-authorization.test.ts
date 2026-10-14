import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemRole } from "@/lib/permissions";
import { resolveSettings } from "@/features/owner/resolve";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({
  actor: { id: "", tenantId: "tenant-a", systemRole: "admin" as SystemRole, tenantView: undefined as object | undefined },
  settings: {} as ReturnType<typeof resolveSettings>,
  readonlyError: null as string | null,
  privileged: false,
  existingStatus: "draft",
  data: { teacher: { name: "synthetic" }, adjustments: { incentive: 0 }, settlement: {} as object | null, amounts: { netPay: 100 } },
  mutations: [] as { kind: string; data: Record<string, unknown>; filters: Record<string, unknown> }[],
  reads: [] as Record<string, unknown>[],
  admin: vi.fn(), audit: vi.fn(), privilege: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: async () => m.readonlyError }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => { m.privilege(); return m.privileged; } }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => m.settings }));
vi.mock("./payslip-queries", () => ({ getPayslipData: async () => m.data }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  m.admin();
  return { from: (table: string) => {
    expect(table).toBe("payslips");
    const filters: Record<string, unknown> = {};
    const read = { eq: (k: string, v: unknown) => { filters[k] = v; return read; }, maybeSingle: async () => { m.reads.push({ ...filters }); return { data: { status: m.existingStatus } }; } };
    return {
      select: () => read,
      upsert: async (data: Record<string, unknown>) => { m.mutations.push({ kind: "upsert", data, filters }); return { error: null }; },
      update: (data: Record<string, unknown>) => {
        const chain = {
          eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
          then: (done: (value: { error: null }) => unknown) => { m.mutations.push({ kind: "update", data, filters }); return Promise.resolve(done({ error: null })); },
        };
        return chain;
      },
    };
  } };
} }));
import { canManagePayslipNow, canViewPayslipNow } from "./payslip-gate";
import { savePayslipAdjustments, issuePayslip, unissuePayslip } from "./payslip-actions";

const actions = [savePayslipAdjustments, issuePayslip, unissuePayslip];
const form = () => {
  const fd = new FormData();
  fd.set("teacherId", B); fd.set("period", "2026-09");
  fd.set("userId", B); fd.set("systemRole", "master"); // Untrusted identity claims must do nothing.
  return fd;
};
function settings(specialAccess: object) {
  m.settings = resolveSettings({ modules: { disabled: [] }, permissions: { specialAccess } }, { name: "" });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.actor = { id: A, tenantId: "tenant-a", systemRole: "admin", tenantView: undefined };
  m.readonlyError = null; m.privileged = false; m.existingStatus = "draft"; m.mutations = []; m.reads = [];
  m.data = { teacher: { name: "synthetic" }, adjustments: { incentive: 0 }, settlement: {}, amounts: { netPay: 100 } };
  settings({ payslipViewerIds: [A], payslipManagerIds: [] });
});

describe("shared authorization and all three actual write actions", () => {
  it.each(["viewer", "unassigned", "empty", "null", "malformed", "module-off", "teacher-readonly", "tenant-readonly"])("%s denies all writes without even opening the admin client", async (kind) => {
    if (kind === "unassigned") settings({ payslipViewerIds: [], payslipManagerIds: [B] });
    if (kind === "empty") settings({ payslipViewerIds: [A], payslipManagerIds: [] });
    if (kind === "null") settings({ payslipViewerIds: [A], payslipManagerIds: null });
    if (kind === "malformed") settings({ payslipViewerIds: [A], payslipManagerIds: [A, 7] });
    if (kind === "module-off") { settings({ payslipManagerIds: [A] }); m.settings.modules.disabled = ["payroll"]; }
    if (kind === "teacher-readonly") { settings({ payslipManagerIds: [A] }); m.readonlyError = "읽기 전용"; }
    if (kind === "tenant-readonly") { settings({ payslipManagerIds: [A] }); m.actor.tenantView = {}; }
    expect(await canManagePayslipNow()).toBe(false);
    for (const action of actions) expect((await action(undefined, form()))?.error).toContain("관리 권한");
    expect(m.admin).not.toHaveBeenCalled(); expect(m.mutations).toEqual([]); expect(m.audit).not.toHaveBeenCalled();
  });

  it("viewer can read; manager alone and legacy viewers can read and manage", async () => {
    expect(await canViewPayslipNow(m.actor)).toBe(true);
    expect(await canManagePayslipNow()).toBe(false);
    for (const special of [{ payslipViewerIds: [], payslipManagerIds: [A] }, { payslipViewerIds: [A] }]) {
      settings(special);
      expect(await canViewPayslipNow(m.actor)).toBe(true);
      expect(await canManagePayslipNow()).toBe(true);
    }
  });

  it.each(["owner", "privileged"])("%s allowance remains below module/readonly restrictions", async (kind) => {
    settings({ payslipViewerIds: [], payslipManagerIds: [] });
    m.actor.systemRole = kind === "owner" ? "master" : "admin"; m.privileged = kind === "privileged";
    expect(await canManagePayslipNow()).toBe(true);
    for (const reason of ["module", "teacher", "tenant"]) {
      m.settings.modules.disabled = reason === "module" ? ["payroll"] : [];
      m.readonlyError = reason === "teacher" ? "읽기 전용" : null;
      m.actor.tenantView = reason === "tenant" ? {} : undefined;
      m.privilege.mockClear();
      for (const action of actions) expect((await action(undefined, form()))?.error).toBeTruthy();
      expect(m.privilege).not.toHaveBeenCalled();
    }
    expect(m.mutations).toEqual([]);
  });

  it("manager-only runs prior editor actions with tenant filters and unchanged audit privacy", async () => {
    settings({ payslipViewerIds: [], payslipManagerIds: [A] });
    for (const action of actions) expect((await action(undefined, form()))?.ok).toBe(true);
    expect(m.mutations).toHaveLength(3);
    expect(m.mutations[0].data).toMatchObject({ tenant_id: "tenant-a", user_id: B, period: "2026-09" });
    expect(m.reads).toEqual([{ tenant_id: "tenant-a", user_id: B, period: "2026-09" }]);
    expect(m.mutations[1].data).toMatchObject({ tenant_id: "tenant-a", issued_by: A, status: "issued", print_payload: m.data });
    expect(m.mutations[2]).toMatchObject({ filters: { tenant_id: "tenant-a", user_id: B, period: "2026-09" }, data: { status: "draft", print_payload: null, issued_by: null } });
    for (const [entry] of m.audit.mock.calls) expect(entry.metadata).toEqual({ userId: B, period: "2026-09" });
  });

  it("issued snapshots cannot be adjusted and invalid/negative calculations cannot be issued", async () => {
    settings({ payslipManagerIds: [A] }); m.existingStatus = "issued";
    expect((await savePayslipAdjustments(undefined, form()))?.error).toContain("이미 발행");
    m.data.settlement = null;
    expect((await issuePayslip(undefined, form()))?.error).toContain("산정");
    m.data.settlement = {}; m.data.amounts.netPay = -1;
    expect((await issuePayslip(undefined, form()))?.error).toContain("음수");
    expect(m.mutations).toEqual([]); expect(m.audit).not.toHaveBeenCalled();
  });
});
