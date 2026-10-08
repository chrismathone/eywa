import { beforeEach, expect, it, vi } from "vitest";
import type { SystemRole, UserPermissionOverride } from "@/lib/permissions";
const h = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant", systemRole: "admin", displayName: "관리자" },
  overrides: [] as unknown[], readonly: false, db: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.actor }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: async () => h.actor }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({ isReadonlyTeacherView: async () => h.readonly, viewAsTeacher: async () => null }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ permissions: { overrides: [], userOverrides: h.overrides }, modules: { disabled: [] }, makeups: { mode: "off" } }) }));
import { attendanceSalaryAdminOrNull, requireAttendanceSalaryAdmin } from "./salary-rates";
const set = (access: UserPermissionOverride["access"], userId = "actor") => {
  h.overrides = [{ userId, menu: "attendance_salary_settings", access } satisfies UserPermissionOverride];
};
beforeEach(() => { vi.clearAllMocks(); h.actor.systemRole = "admin"; h.overrides = []; h.readonly = false; });
it("역할상 관리자여도 이 사람의 급여 설정 권한이 없음이면 조회·저장 모두 막는다", async () => {
  set("none");
  expect(await attendanceSalaryAdminOrNull(false)).toBeNull();
  expect(await requireAttendanceSalaryAdmin()).toBeNull();
  expect(h.db).not.toHaveBeenCalled();
});
it.each(["readonly", "scoped"] as const)("개인별 %s는 읽기만 허용하고 급여 설정 저장을 허용하지 않는다", async (access) => {
  set(access);
  expect(await attendanceSalaryAdminOrNull(false)).toEqual(h.actor);
  expect(await requireAttendanceSalaryAdmin()).toBeNull();
  expect(h.db).not.toHaveBeenCalled();
});
it("개인별 전체 권한을 받은 사람만 수정할 수 있고 같은 역할의 다른 사람 예외는 섞이지 않는다", async () => {
  h.actor.systemRole = "accountant" satisfies SystemRole;
  set("full", "other");
  expect(await attendanceSalaryAdminOrNull(false)).toBeNull();
  set("full");
  expect(await attendanceSalaryAdminOrNull(false)).toEqual(h.actor);
  expect(await requireAttendanceSalaryAdmin()).toEqual(h.actor);
});
it("열람 전용 강사뷰에서는 개인별 전체 권한도 개인 급여 설정을 열지 못한다", async () => {
  set("full"); h.readonly = true;
  expect(await attendanceSalaryAdminOrNull(false)).toBeNull();
  expect(await requireAttendanceSalaryAdmin()).toBeNull();
});
