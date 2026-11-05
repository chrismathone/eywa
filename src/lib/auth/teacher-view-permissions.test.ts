import { beforeEach, expect, it, vi } from "vitest";
import { canAccess, MENU_ACCESS, SYSTEM_ROLES, type SystemRole, type PermissionOverride, type UserPermissionOverride } from "../permissions";
const m = vi.hoisted(() => ({ access: null as null | "full" | "readonly", targetRole: "teacher" as SystemRole, overrides: [] as PermissionOverride[], individual: [] as UserPermissionOverride[] }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "branch", systemRole: "master" }) }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false, isSignedInSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({
  viewAsTeacher: async () => m.access ? { id: "target", tenantId: "branch", systemRole: m.targetRole, access: m.access } : null,
  isReadonlyTeacherView: async () => m.access === "readonly",
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => ["makeups"] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({
  modules: { disabled: [] }, permissions: { overrides: m.overrides, userOverrides: m.individual },
}) }));
import { accessLevelTenant, canWriteTenant, getActorPermMatrix, getUserPermMatrix } from "./perm-matrix";
import { nextPermissionAccess, permissionAccessOptions } from "@/features/owner/permission-edit";
beforeEach(() => { m.access = null; m.targetRole = "teacher"; m.overrides = []; m.individual = []; });
it("defaults teacher-view access to master only and offers exactly three levels", () => {
  for (const role of SYSTEM_ROLES) expect(MENU_ACCESS.teacher_view[role]).toBe(role === "master" ? "full" : "none");
  expect(permissionAccessOptions("teacher_view")).toEqual(["full", "readonly", "none"]);
  expect(nextPermissionAccess("teacher_view", "admin", "full")).toBe("readonly");
  expect(nextPermissionAccess("teacher_view", "admin", "readonly")).toBe("none");
});
it("full view uses target role and individual grants without inheriting master authority", async () => {
  m.access = "full";
  m.individual = [{ userId: "target", menu: "student_english_name", access: "full" }];
  expect(await accessLevelTenant("master", "ecs")).toBe("scoped");
  expect(await canWriteTenant("master", "student_english_name")).toBe(true);
  expect(await canWriteTenant("master", "owner")).toBe(false);
  expect((await getActorPermMatrix()).teacher_view.master).toBe("full");
});
it("target denials win over the actor's own grants", async () => {
  m.access = "full";
  m.individual = [{ userId: "actor", menu: "student_english_name", access: "full" }, { userId: "target", menu: "ecs", access: "none" }];
  expect(await canWriteTenant("master", "student_english_name")).toBe(false);
  expect(await accessLevelTenant("master", "ecs")).toBe("none");
});
it("read-only view denies mutations even when the target has full access", async () => {
  m.access = "readonly";
  m.individual = [{ userId: "target", menu: "student_english_name", access: "full" }];
  expect(await accessLevelTenant("master", "ecs")).toBe("readonly");
  expect(await canWriteTenant("teacher", "student_english_name")).toBe(false);
});
it.each(SYSTEM_ROLES.filter(role => role !== "student"))("%s target keeps the teacher home reachable in full and read-only views", async (role) => {
  m.targetRole = role;
  for (const access of ["full", "readonly"] as const) {
    m.access = access;
    const matrix = await getUserPermMatrix();
    // The shell tests the teacher row; page/action guards use the actual actor row.
    expect(canAccess("teacher", "teacher_onescreen", matrix)).toBe(true);
    expect(matrix.teacher_onescreen.master).toBe(access);
    expect(matrix.teacher_onescreen[role]).toBe(access);
    expect(await canWriteTenant("master", "teacher_onescreen")).toBe(access === "full");
    expect(matrix.my_learning.master).toBe("none");
  }
});
it("does not grant an administrator the teacher-only menu outside a validated teacher view", async () => {
  expect(canAccess("teacher", "teacher_onescreen", await getUserPermMatrix())).toBe(true);
  expect(await canWriteTenant("master", "teacher_onescreen")).toBe(false);
});
it("keeps an administrator target's personal denials while preserving the teacher home", async () => {
  m.access = "full";
  m.targetRole = "admin";
  m.individual = [{ userId: "target", menu: "ecs", access: "none" }, { userId: "target", menu: "mcs", access: "readonly" }];
  const matrix = await getUserPermMatrix();
  expect(matrix.ecs.teacher).toBe("none");
  expect(matrix.mcs.master).toBe("readonly");
  expect(matrix.teacher_onescreen.teacher).toBe("full");
});
it("전자결재는 강사뷰에서 닫힌다 — 대상 강사에게 열려 있어도(결재는 본인 서명 · 원장 2026-11-05 점검)", async () => {
  m.individual = [{ userId: "target", menu: "approvals", access: "full" }, { userId: "actor", menu: "approvals", access: "full" }];
  // 강사뷰가 아니면 본인 권한 그대로
  expect(await canAccessApprovals()).toBe(true);
  for (const access of ["full", "readonly"] as const) {
    m.access = access;
    expect(await canAccessApprovals()).toBe(false);
    expect(await canWriteTenant("master", "approvals")).toBe(false);
  }
});
async function canAccessApprovals() {
  return canAccess("master", "approvals", await getUserPermMatrix());
}
