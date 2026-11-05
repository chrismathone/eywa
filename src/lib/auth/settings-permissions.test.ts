import { beforeEach, expect, it, vi } from "vitest";
import type { PermissionOverride, SystemRole, UserPermissionOverride } from "../permissions";
import { SETTINGS_ROLE_KEYS } from "../settings-role-catalog";

const s = vi.hoisted(() => ({ role: "admin" as SystemRole, super: false, readonly: false, licensed: true,
  laboratory: true, makeupsOn: false,
  overrides: [] as PermissionOverride[], userOverrides: [] as UserPermissionOverride[], disabled: [] as string[] }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "u1", tenantId: "t1", systemRole: s.role }) }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => s.super, isSignedInSuperAdmin: async () => s.super }));
vi.mock("@/lib/auth/view-as", () => ({ isReadonlyTeacherView: async () => s.readonly, viewAsTeacher: async () => null }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => s.licensed, isFeatureOptedIn: async () => s.laboratory }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => ["makeups"] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ preset: "generic", modules: { disabled: s.disabled }, makeups: { mode: s.makeupsOn ? "on" : "off", allowAdditional: false, pilotSubjects: ["math"] }, permissions: { overrides: s.overrides, userOverrides: s.userOverrides } }) }));
import { canAccessTenant, canWriteTenant, getUserPermMatrix } from "./perm-matrix";
import { teacherMenuKeysFor } from "../navigation";
import { teacherNavigationFor } from "../teacher-navigation";
import { hubGroupsFor, SUPPORT_GROUPS } from "../menu-hub";

beforeEach(() => { s.role = "admin"; s.super = false; s.readonly = false; s.licensed = true; s.laboratory = true; s.makeupsOn = false; s.overrides = []; s.userOverrides = []; s.disabled = []; });
it("실험실 메뉴는 운영 설정과 학원별 실험실 허용을 모두 요구한다", async () => {
  s.super = true;
  s.makeupsOn = true;
  s.laboratory = false;
  expect(await canAccessTenant("admin", "makeups")).toBe(false);
  s.laboratory = true;
  expect(await canAccessTenant("admin", "makeups")).toBe(true);
  s.makeupsOn = false;
  expect(await canAccessTenant("admin", "makeups")).toBe(false);
});
it("관리자의 owner 권한이 있어도 새 보고서·AI 설정을 임의로 수정하지 못한다", async () => {
  s.overrides = [{ menu: "owner", role: "admin", access: "full" }];
  expect(await canWriteTenant("admin", "report_settings")).toBe(false);
  expect(await canWriteTenant("admin", "ai_ment")).toBe(false);
});
it("조회 전용은 메뉴를 볼 수 있지만 쓰기는 차단한다", async () => {
  s.overrides = [{ menu: "report_settings", role: "admin", access: "readonly" }];
  expect(await canAccessTenant("admin", "report_settings")).toBe(true);
  expect(await canWriteTenant("admin", "report_settings")).toBe(false);
});
it("개인별 예외는 역할 허용보다 우선한다", async () => {
  s.overrides = [{ menu: "report_settings", role: "admin", access: "full" }];
  s.userOverrides = [{ userId: "u1", menu: "report_settings", access: "none" }];
  expect(await canAccessTenant("admin", "report_settings")).toBe(false);
});
it.each([false,true])("슈퍼관리자는 역할·개인 거부가 있어도 모든 설정을 연다 (거부=%s)", async denied => {
  s.super = true;
  if (denied) {
    s.overrides = SETTINGS_ROLE_KEYS.map(menu => ({ menu, role: "admin", access: "none" }));
    s.userOverrides = SETTINGS_ROLE_KEYS.map(menu => ({ menu, userId: "u1", access: "none" }));
  }
  for (const menu of SETTINGS_ROLE_KEYS) expect(await canWriteTenant("admin", menu),menu).toBe(true);
});
it("슈퍼관리자도 다른 강사 보기에서 저장하지 못한다", async () => {
  s.super = true; s.readonly = true;
  expect(await canAccessTenant("admin", "report_settings")).toBe(true);
  expect(await canWriteTenant("admin", "report_settings")).toBe(false);
});
it("꺼진 급여·키오스크·AI는 슈퍼관리자와 개인 허용으로도 되살리지 않는다", async () => {
  s.super = true; s.disabled = ["payroll","kiosk"]; s.licensed = false;
  for (const menu of ["payroll_settings","attendance_salary_settings","kiosk_settings","ai_ment"] as const) expect(await canAccessTenant("admin",menu)).toBe(false);
});
it("설정만 위임한 강사에게 내 메뉴의 해당 설정 입구만 표시한다", async () => {
  s.role = "teacher"; s.overrides = [{ menu: "report_settings", role: "teacher", access: "full" }];
  const matrix = await getUserPermMatrix();
  const menus = teacherMenuKeysFor("teacher", matrix);
  const items = teacherNavigationFor({ menus }).groups.flatMap(g => g.items);
  expect(items.some(i => i.href === "/lesson-reports?tab=report")).toBe(true);
  expect(items.some(i => i.href === "/lesson-reports?tab=ai_ment")).toBe(false);
  expect(matrix.lesson_reports.teacher).toBe("none");
});
it("운영 설정만 위임한 관리자는 설정 허브에서 그 설정만 찾을 수 있다", async () => {
  s.overrides = [{ menu: "operations_settings", role: "admin", access: "full" }];
  const items = hubGroupsFor(SUPPORT_GROUPS,{ systemRole:"admin", permMatrix:await getUserPermMatrix() }).flatMap(g => g.items);
  expect(items.some(i => i.href === "/owner?tab=operations")).toBe(true);
  expect(items.some(i => i.href === "/owner?tab=subjects")).toBe(true);
  expect(items.some(i => i.href === "/owner?tab=permissions")).toBe(false);
  expect(items.some(i => i.href === "/owner")).toBe(false);
});
