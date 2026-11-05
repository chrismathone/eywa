import { beforeEach, expect, it, vi } from "vitest";
import { resolveMatrix, type Access, type SystemRole } from "../permissions";
const ACTOR = "10000000-0000-4000-8000-000000000001";
const TARGET = "20000000-0000-4000-8000-000000000001";
const m = vi.hoisted(() => ({ access: "none" as Access, role: "admin" as SystemRole, cookie: "20000000-0000-4000-8000-000000000001", tenant: "branch", status: "active", targetRole: "teacher", reads: 0, tenantView: false }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "10000000-0000-4000-8000-000000000001", tenantId: "branch", systemRole: m.role, ...(m.tenantView ? { tenantView: { tenantId: "branch", tenantName: "Branch" } } : {}) }) }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false, isSignedInSuperAdmin: async () => false, isProtectedSuperAdminTarget: async () => false }));
vi.mock("@/lib/auth/perm-matrix", () => ({ getActorPermMatrix: async () => resolveMatrix([{ menu: "teacher_view", role: m.role, access: m.access }]) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => ({ value: key === "eywa-view" ? "teacher" : m.cookie }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => {
    m.reads++; return { data: { id: "20000000-0000-4000-8000-000000000001", tenant_id: m.tenant, status: m.status, system_role: m.targetRole, display_name: "Teacher", email: "", job_title: null } };
  } }; return q;
} }) }));
import { canUseOtherTeacherView, otherTeacherViewAccess, viewAsTeacher, readonlyTeacherViewError, READONLY_TEACHER_VIEW_ERROR } from "./view-as";
beforeEach(() => { m.access = "none"; m.role = "admin"; m.cookie = TARGET; m.tenant = "branch"; m.status = "active"; m.targetRole = "teacher"; m.reads = 0; m.tenantView = false; });
it("an operator's read-only tenant view never switches into a teacher view, even with a full grant and leftover cookies", async () => {
  m.access = "full"; m.role = "master"; m.tenantView = true;
  expect(await otherTeacherViewAccess()).toBe("none");
  expect(await canUseOtherTeacherView()).toBe(false);
  expect(await viewAsTeacher()).toBeNull();
  expect(m.reads).toBe(0);
  m.tenantView = false;
  expect(await viewAsTeacher()).toMatchObject({ id: TARGET, access: "full" });
});
it("a forged cookie gives no access without an explicit grant", async () => {
  expect(await viewAsTeacher()).toBeNull(); expect(m.reads).toBe(0);
});
it.each(["full", "readonly"] as const)("returns the validated target with %s access", async (access) => {
  m.access = access;
  expect(await viewAsTeacher()).toMatchObject({ id: TARGET, access });
  expect(await readonlyTeacherViewError()).toBe(access === "full" ? null : READONLY_TEACHER_VIEW_ERROR);
});
it("rejects another branch, an inactive target, a student and malformed/self cookies", async () => {
  m.access = "full"; m.tenant = "another"; expect(await viewAsTeacher()).toBeNull();
  m.tenant = "branch"; m.status = "inactive"; expect(await viewAsTeacher()).toBeNull();
  m.status = "active"; m.targetRole = "student"; expect(await viewAsTeacher()).toBeNull();
  m.targetRole = "teacher"; m.cookie = "forged"; expect(await viewAsTeacher()).toBeNull();
  m.cookie = ACTOR; expect(await viewAsTeacher()).toBeNull();
});
it("allows an explicitly granted teacher and denies the unsupported scoped level", async () => {
  m.role = "teacher"; m.access = "full"; expect(await viewAsTeacher()).toMatchObject({ id: TARGET });
  m.access = "scoped"; expect(await viewAsTeacher()).toBeNull();
});
