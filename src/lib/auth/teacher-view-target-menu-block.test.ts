import { expect, it, vi } from "vitest";
import { canAccess } from "@/lib/permissions";
import { USER_MENU_BLOCKS } from "@/lib/auth/user-menu-blocks";

// 대상 X의 개인 메뉴 차단(USER_MENU_BLOCKS)은 X의 강사뷰에도 걸린다(2026-11-05 강사뷰 적대 리뷰) — 보는 사람 A의 차단과 둘 다 누른다.
const BLOCKED_X = "07cbe245-e8c8-4938-a974-8873689f72f4"; // user-menu-blocks.ts의 유일한 줄(직원관리 차단)
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "branch", systemRole: "master" }) }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false, isSignedInSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({
  viewAsTeacher: async () => ({ id: BLOCKED_X, tenantId: "branch", systemRole: "admin", access: "full" }),
  isReadonlyTeacherView: async () => false,
}));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewWriteBlocked: async () => false, isTenantViewRequest: async () => false }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => [] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({
  modules: { disabled: [] }, makeups: {}, permissions: { overrides: [], userOverrides: [] },
}) }));
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";

it("X 본인 화면에서 닫힌 메뉴(직원관리)는 A가 X의 강사뷰로 들어가도 닫혀 있다", async () => {
  expect(USER_MENU_BLOCKS[BLOCKED_X]).toContain("staff"); // 전제 — 명단이 바뀌면 이 시험도 함께 고친다
  const matrix = await getUserPermMatrix();
  expect(canAccess("master", "staff", matrix)).toBe(false);
  expect(canAccess("admin", "staff", matrix)).toBe(false);
});
