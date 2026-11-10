import { describe, expect, it } from "vitest";
import { canAccess, MENU_ACCESS, MENU_KEYS, type MenuKey, type SystemRole } from "@/lib/permissions";
import { HUB_GROUPS, hubGroupsFor, INNER_TABS, innerTabsOf } from "@/lib/menu-hub";
import { canOpenCore } from "@/features/dashboard/layout/view";
import { canOpenShuttleAdmin } from "@/features/shuttle/admin-access";

/**
 * 원장 2026-11-10 결정 — 기본 권한표(코드 기본값)에서 화면 입구가 함께 바뀌는지:
 *  · 시안 넷(경영 분석·지식그래프 · 조직·OKR · 연간 운영계획·홍보·마케팅 · 업무 작성센터) = 원장만 — 메뉴 버튼 · 운영실 핵심 업무 칸 · 페이지 문.
 *  · 셔틀 관리자 화면(학부모 관리 현황 · 탑승 학생 시간표 · 가까운 노선 찾기 · 실시간 위치) = 원장·관리자 · 셔틀 권한 위 조건.
 */
const SAMPLE_HREFS = ["/dashboard/management/knowledge", "/organization/okr", "/marketing", "/billing/management/marketing", "/work-records"];
const SHUTTLE_ADMIN_HREFS = ["/shuttle/parents", "/shuttle/classes", "/shuttle/nearby", "/shuttle/track"];
const hrefsFor = (role: SystemRole, matrix = MENU_ACCESS) => {
  const groups = hubGroupsFor(HUB_GROUPS, { systemRole: role, permMatrix: matrix, isMaster: role === "master" });
  const main = groups.flatMap((g) => g.items.map((d) => d.href));
  // 셔틀 화면 위 탭(검색 팰릿이 셔틀 뒤에 싣는 면) — 셔틀이 보일 때만.
  const tabs = main.includes("/shuttle") ? innerTabsOf("/shuttle", { systemRole: role, permMatrix: matrix }).map((d) => d.href) : [];
  return new Set([...main, ...tabs]);
};
const allowedSet = (role: SystemRole, matrix = MENU_ACCESS) => new Set<MenuKey>(MENU_KEYS.filter((m) => canAccess(role, m, matrix)));

describe("시안 넷 = 원장만 — 메뉴 버튼 · 운영실 핵심 업무 칸 · 페이지 문", () => {
  it("원장에게는 선다", () => {
    const hrefs = hrefsFor("master");
    for (const href of SAMPLE_HREFS) expect(hrefs.has(href), href).toBe(true);
    expect(canOpenCore("core:management", "owner", allowedSet("master"))).toBe(true);
    expect(canOpenCore("core:workRecords", "owner", allowedSet("master"))).toBe(true);
  });

  it.each(["admin", "manager", "counselor", "accountant", "viewer"] as const)("🔴 %s에게는 메뉴 버튼도 · 핵심 업무 칸도 · 페이지 문도 닫힌다", (role) => {
    const hrefs = hrefsFor(role);
    for (const href of SAMPLE_HREFS) expect(hrefs.has(href), `${role} ${href}`).toBe(false);
    const menus = allowedSet(role);
    expect(canOpenCore("core:management", "desk", menus)).toBe(false);
    expect(canOpenCore("core:workRecords", "desk", menus)).toBe(false);
    // 페이지 문 = requireAccess(그 키) — 같은 표(canAccess)를 본다.
    for (const menu of ["management", "okr", "marketing", "work_records"] as const) expect(canAccess(role, menu), `${role} ${menu}`).toBe(false);
  });
});

describe("셔틀 관리자 화면 = 원장·관리자 · 셔틀 권한 위 조건(기존 동작 유지)", () => {
  it("원장·관리자에게는 학부모 관리 현황 버튼과 셔틀 위 탭 셋이 선다 — 매니저(셔틀 '전체')에게는 안 선다", () => {
    for (const role of ["master", "admin"] as const) {
      const hrefs = hrefsFor(role);
      for (const href of SHUTTLE_ADMIN_HREFS) expect(hrefs.has(href), `${role} ${href}`).toBe(true);
      expect(canOpenShuttleAdmin(role, MENU_ACCESS, false)).toBe(true);
    }
    const manager = hrefsFor("manager");
    expect(manager.has("/shuttle")).toBe(true);
    for (const href of SHUTTLE_ADMIN_HREFS) expect(manager.has(href), href).toBe(false);
    expect(canOpenShuttleAdmin("manager", MENU_ACCESS, false)).toBe(false);
    // 강사·열람(셔틀 '읽기')에게도 안 선다 — 전엔 '실시간 위치' 탭이 검색에 섰다가 누르면 404였다.
    for (const role of ["teacher", "viewer"] as const) {
      const hrefs = hrefsFor(role);
      for (const href of SHUTTLE_ADMIN_HREFS) expect(hrefs.has(href), `${role} ${href}`).toBe(false);
    }
  });

  it("🔴 셔틀 권한이 닫히면 셔틀 관리자 화면도 닫힌다 — 셔틀 자리에 대신 입구로도 서지 않는다", () => {
    const closed = { ...MENU_ACCESS, shuttle: { ...MENU_ACCESS.shuttle, admin: "none" as const } };
    expect(canOpenShuttleAdmin("admin", closed, false)).toBe(false);
    const hrefs = hrefsFor("admin", closed);
    for (const href of [...SHUTTLE_ADMIN_HREFS, "/shuttle"]) expect(hrefs.has(href), href).toBe(false);
    // 운영 계정은 종전처럼 통과(결정 로그 2026-08-13).
    expect(canOpenShuttleAdmin("admin", closed, true)).toBe(true);
  });

  it("셔틀 위 탭 표 — 관리자 화면 탭은 모두 셔틀 관리자 화면 권한 + 셔틀 권한을 함께 본다", () => {
    const tabs = INNER_TABS.find((t) => t.parent === "/shuttle")!.items.filter((d) => SHUTTLE_ADMIN_HREFS.includes(d.href));
    expect(tabs.map((d) => d.href).sort()).toEqual(["/shuttle/classes", "/shuttle/nearby", "/shuttle/track"]);
    for (const d of tabs) expect([d.menuKey, d.alsoNeeds], d.href).toEqual(["shuttle_admin", "shuttle"]);
  });
});
