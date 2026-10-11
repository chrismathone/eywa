import { beforeEach, expect, it, vi } from "vitest";
import { MENU_ACCESS, SYSTEM_ROLES, type PermissionOverride, type UserPermissionOverride } from "../permissions";
const m = vi.hoisted(() => ({ access: null as null | "full" | "readonly", overrides: [] as PermissionOverride[], individual: [] as UserPermissionOverride[] }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "branch", systemRole: "master" }) }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({
  viewAsTeacher: async () => m.access ? { id: "target", tenantId: "branch", systemRole: "teacher", access: m.access } : null,
  isReadonlyTeacherView: async () => m.access === "readonly",
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => ["makeups"] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({
  modules: { disabled: [] }, permissions: { overrides: m.overrides, userOverrides: m.individual },
}) }));
import { accessLevelTenant, canWriteTenant, getActorPermMatrix } from "./perm-matrix";
import { nextPermissionAccess, permissionAccessOptions } from "@/features/owner/permission-edit";
beforeEach(() => { m.access = null; m.overrides = []; m.individual = []; });
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
