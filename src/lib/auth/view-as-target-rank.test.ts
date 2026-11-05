import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPermissionOverride } from "@/lib/permissions";
import { canViewAsRole } from "@/lib/auth/role-hierarchy";

// '다른 강사 뷰' 대상 위계(2026-11-05 강사뷰 적대 리뷰 치명) — 자기보다 높은 역할은 대상이 될 수 없다.
// 계기: 강사뷰 권한을 개인 예외로 받은 상담사가 반을 맡은 원장을 골라 원장의 권한표 · 할 일 현황 · 받은함을 빌렸다.
// view-as · perm-matrix · 할 일 게이트 · 받은함은 실제 모듈(진입과 매 요청 재검증이 같은 loadViewAsTarget을 쓴다).
type U = { id: string; tenantId: string; email: string; displayName: string; jobTitle: string | null; systemRole: string };
const X_ID = "22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({
  actor: null as unknown as U,
  cookies: {} as Record<string, string>,
  userOverrides: [] as UserPermissionOverride[],
  targetRow: null as null | Record<string, unknown>,
  signedInSuper: false,
  protectedTarget: false,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (k in m.cookies ? { value: m.cookies[k] } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (o?: { teacherView: boolean }) => {
    if (!o?.teacherView) return m.actor;
    const { viewAsTeacher } = await import("@/lib/auth/view-as");
    return (await viewAsTeacher()) ?? m.actor;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({
  isCurrentUserSuperAdmin: async () => false,
  isSignedInSuperAdmin: async () => m.signedInSuper,
  isProtectedSuperAdminTarget: async () => m.protectedTarget,
}));
vi.mock("@/lib/auth/tenant-view", () => ({
  isTenantViewWriteBlocked: async () => false, isTenantViewRequest: async () => false, tenantViewWriteError: async () => null,
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => [] }));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({
    modules: { disabled: [] }, makeups: {},
    permissions: { overrides: [], userOverrides: m.userOverrides, specialAccess: { staffTaskMonitorIds: [] } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.targetRow }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ kind: "admin" }) }));

import { viewAsTeacher, loadViewAsTarget } from "@/lib/auth/view-as";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { notificationInbox } from "@/features/notifications/server/inbox";

const actorOf = (systemRole: string): U => ({ id: "11111111-1111-4111-8111-111111111111", tenantId: "t1", email: "a@x", displayName: "보는 사람", jobTitle: null, systemRole });
const rowOf = (system_role: string) => ({ id: X_ID, tenant_id: "t1", email: "x@x", display_name: "대상", job_title: null, system_role, status: "active" });

beforeEach(() => {
  m.actor = actorOf("counselor");
  // 원장이 상담사에게 '강사뷰 접근'(전체)을 개인별로 줬다.
  m.userOverrides = [{ userId: m.actor.id, menu: "teacher_view", access: "full" }];
  m.cookies = { "eywa-view": "teacher", "eywa-view-as": X_ID };
  m.targetRow = rowOf("master");
  m.signedInSuper = false;
  m.protectedTarget = false;
});

describe("canViewAsRole — 같거나 낮은 역할만", () => {
  it("높은 역할은 안 된다 · 같은 역할과 낮은 역할은 된다 · 학생은 늘 안 된다", () => {
    expect(canViewAsRole("counselor", "master")).toBe(false);
    expect(canViewAsRole("manager", "admin")).toBe(false);
    expect(canViewAsRole("admin", "admin")).toBe(true);
    expect(canViewAsRole("admin", "teacher")).toBe(true);
    expect(canViewAsRole("master", "master")).toBe(true);
    expect(canViewAsRole("master", "student")).toBe(false);
  });
});

describe("상담사 A → 원장 X: 대상이 되지 않는다", () => {
  it("진입 검증 · 매 요청 재검증 모두 null", async () => {
    expect(await loadViewAsTarget(X_ID)).toBeNull();
    expect(await viewAsTeacher()).toBeNull();
  });
  it("원장의 힘을 빌리지 못한다 — 권한표 · 할 일 현황 · 받은함이 모두 본인(A) 것", async () => {
    expect(await canWriteTenant("counselor", "staff")).toBe(false);
    const viewer = await getStaffTaskViewer();
    expect(viewer?.user.id).toBe(m.actor.id);
    expect(viewer?.canMonitor).toBe(false);
    expect(await notificationInbox()).toMatchObject({ recipientId: m.actor.id, viewAs: false });
  });
});

describe("허용되는 대상", () => {
  it("상담사 A → 강사 X(낮은 역할)는 된다", async () => {
    m.targetRow = rowOf("teacher");
    expect(await viewAsTeacher()).toMatchObject({ id: X_ID, systemRole: "teacher", access: "full" });
  });
  it("관리자 A → 관리자 X(같은 역할)는 된다 — 자리를 비운 같은 급 직원을 대신한다", async () => {
    m.actor = actorOf("admin");
    m.userOverrides = [];
    m.targetRow = rowOf("admin");
    expect(await loadViewAsTarget(X_ID)).toMatchObject({ id: X_ID, systemRole: "admin" });
  });
  it("운영 계정(실제 로그인)은 위계 예외 — 원장도 된다", async () => {
    m.signedInSuper = true;
    expect(await loadViewAsTarget(X_ID)).toMatchObject({ id: X_ID, systemRole: "master" });
  });
  it("대상이 운영 계정이면 실제 계정도 운영 계정일 때만(보호 판정이 막으면 null)", async () => {
    m.actor = actorOf("master");
    m.userOverrides = [];
    m.protectedTarget = true;
    expect(await loadViewAsTarget(X_ID)).toBeNull();
  });
});
