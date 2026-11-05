import { beforeEach, describe, expect, it, vi } from "vitest";
import { MENU_KEYS, resolveMatrix, SYSTEM_ROLES, type PermissionOverride, type UserPermissionOverride } from "../permissions";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 권한 쪽의 캡.
 *
 * 지키려는 것:
 * - 보는 중에는 원장 줄에 전체 · 담당 권한이 하나도 남지 않는다(읽기로 눌린다). 없음은 그대로다(읽기를 넓히지 않는다).
 * - 보기에서 닫는 메뉴(지점을 로그인한 사람의 행에서 직접 정하는 화면)는 없음이다.
 * - 쓰기 게이트는 보기 쿠키가 남아 있기만 해도(끝난 보기 · 확인하지 못함) 닫힌다 — 그때 매트릭스는 본인 것 그대로다.
 */
const m = vi.hoisted(() => ({
  live: false,
  blocked: false,
  overrides: [] as PermissionOverride[],
  individual: [] as UserPermissionOverride[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "branch", systemRole: "master", ...(m.live ? { tenantView: { tenantId: "branch", tenantName: "지점" } } : {}) }) }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false, isSignedInSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: async () => null, isReadonlyTeacherView: async () => false }));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewRequest: async () => m.live, isTenantViewWriteBlocked: async () => m.blocked }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => ["makeups"] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({
  modules: { disabled: [] }, permissions: { overrides: m.overrides, userOverrides: m.individual },
}) }));

import { accessLevelTenant, canAccessTenant, canWriteTenant, capTenantViewReadonly, getActorPermMatrix, getUserPermMatrix, TENANT_VIEW_CLOSED_MENUS } from "./perm-matrix";

beforeEach(() => { m.live = false; m.blocked = false; m.overrides = []; m.individual = []; });

describe("읽기 전용 캡(순수)", () => {
  it("전체 · 담당 → 읽기, 읽기 → 읽기, 없음 → 없음, 닫는 메뉴 → 없음", () => {
    const base = resolveMatrix([
      { menu: "students", role: "master", access: "scoped" },
      { menu: "billing", role: "master", access: "readonly" },
      { menu: "staff", role: "master", access: "none" },
    ]);
    const capped = capTenantViewReadonly(base, "master");
    expect(capped.dashboard.master).toBe("readonly"); // 전체였다
    expect(capped.students.master).toBe("readonly"); // 담당이었다
    expect(capped.billing.master).toBe("readonly");
    expect(capped.staff.master).toBe("none"); // 없음을 읽기로 넓히지 않는다
    for (const menu of TENANT_VIEW_CLOSED_MENUS) expect(capped[menu].master, menu).toBe("none");
  });

  it("🔴 원장 줄에 전체 · 담당이 하나도 남지 않는다 — 모든 메뉴", () => {
    const capped = capTenantViewReadonly(resolveMatrix([]), "master");
    for (const menu of MENU_KEYS) expect(["readonly", "none"], menu).toContain(capped[menu].master);
  });

  it("다른 역할의 줄은 건드리지 않는다(받은 매트릭스도 바꾸지 않는다)", () => {
    const base = resolveMatrix([]);
    const before = JSON.stringify(base);
    const capped = capTenantViewReadonly(base, "master");
    for (const menu of MENU_KEYS) for (const role of SYSTEM_ROLES) if (role !== "master") expect(capped[menu][role], `${menu}/${role}`).toBe(base[menu][role]);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("닫는 메뉴 = 보강관리 · 전자결재 · 급여 설정", () => {
    expect([...TENANT_VIEW_CLOSED_MENUS].sort()).toEqual(["approvals", "makeups", "payroll_settings"]);
  });
});

describe("보는 중의 권한", () => {
  it("🔴 유효 매트릭스(사이드바 · 화면 문 · 쓰기 문이 읽는 것)의 원장 줄이 통째로 읽기 전용이다", async () => {
    m.live = true;
    m.blocked = true;
    for (const matrix of [await getActorPermMatrix(), await getUserPermMatrix()]) {
      for (const menu of MENU_KEYS) expect(["readonly", "none"], menu).toContain(matrix[menu].master);
      for (const menu of TENANT_VIEW_CLOSED_MENUS) expect(matrix[menu].master, menu).toBe("none");
    }
  });

  it("🔴 원장이 저장해 둔 개인 예외(전체 권한)가 있어도 읽기를 넘지 않고, 닫는 메뉴도 다시 열리지 않는다", async () => {
    m.live = true;
    m.blocked = true;
    m.individual = [
      { userId: "actor", menu: "students", access: "full" },
      { userId: "actor", menu: "makeups", access: "full" },
      { userId: "actor", menu: "approvals", access: "full" },
    ];
    const matrix = await getUserPermMatrix();
    expect(matrix.students.master).toBe("readonly");
    expect(matrix.makeups.master).toBe("none");
    expect(matrix.approvals.master).toBe("none");
    expect(await canAccessTenant("master", "makeups")).toBe(false);
  });

  it("쓰기 게이트는 어떤 메뉴에서도 닫히고, 접근 수준은 읽기를 넘지 않는다 — 읽기 게이트는 열려 있다", async () => {
    m.live = true;
    m.blocked = true;
    for (const menu of MENU_KEYS) {
      expect(await canWriteTenant("master", menu), menu).toBe(false);
      expect(["readonly", "none"], menu).toContain(await accessLevelTenant("master", menu));
    }
    expect(await canAccessTenant("master", "students")).toBe(true);
    expect(await canAccessTenant("master", "dashboard")).toBe(true);
  });
});

describe("보기 쿠키만 남은 요청(끝난 보기 · 확인하지 못함)", () => {
  it("🔴 매트릭스는 본인 것 그대로지만 쓰기 게이트는 닫힌다", async () => {
    m.live = false;
    m.blocked = true;
    const matrix = await getActorPermMatrix();
    expect(matrix.students.master).toBe("full"); // 캡은 살아 있는 보기에만 얹힌다
    for (const menu of MENU_KEYS) {
      expect(await canWriteTenant("master", menu), menu).toBe(false);
      expect(["readonly", "none"], menu).toContain(await accessLevelTenant("master", menu));
    }
  });
});

describe("보기가 아닌 요청", () => {
  it("한 글자도 달라지지 않는다 — 캡이 얹히지 않고 쓰기 게이트가 열려 있다", async () => {
    const matrix = await getActorPermMatrix();
    expect(matrix.students.master).toBe("full");
    expect(await canWriteTenant("master", "students")).toBe(true);
    expect(await accessLevelTenant("master", "students")).toBe("full");
  });
});
