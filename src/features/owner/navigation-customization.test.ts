import { describe, expect, it } from "vitest";
import { configuredHubGroups, HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor, frequentFor, hubGroupOfPath, hubSearchKeywords } from "@/lib/menu-hub";
import { MENU_KEYS, resolveMatrix } from "@/lib/permissions";
import { navigationSchema } from "./settings-types";
import { resolveSettings } from "./resolve";
import { prepareSectionForSave } from "./preset";
import { normalizeGroupRows, normalizeMenuRows, type MenuLayoutRow, type MenuGroupLayoutRow } from "./menu-layout";
import { normalizeNavigationSettings, navigationRevision } from "./normalize-navigation";
import { diffSettingsSection } from "./settings-diff";

const all = [...HUB_GROUPS, ...SUPPORT_GROUPS];
const groups: MenuGroupLayoutRow[] = [{ id: "custom-desk", label: "교무실", icon: "folder", order: 0 }];
// 같은 권한(출석부)의 면 하나(오늘 출결)를 새 탭으로 — 수납의 면은 2026-10-14부터 메뉴가 아니다(화면 안 탭, `INNER_TABS`).
const menus: MenuLayoutRow[] = [{ href: "/attendance/live", groupId: "custom-desk", label: "운영비", icon: "star", order: 0 }];
const gate = { systemRole: "master" as const, isMaster: true, canTeacherView: true };

describe("학원 탭 구성: 원본 목적지와 표시 설정", () => {
  it("빈 설정은 기존 그룹·메뉴·순서·아이콘을 보존한다", () => {
    const shape = (xs: typeof all) => xs.map((g) => ({ id: g.id, label: g.label, icon: g.icon, kind: g.kind, items: g.items.map((d) => ({ href: d.href, label: d.label, icon: d.icon })) }));
    expect(shape(configuredHubGroups(all, [], []))).toEqual(shape(all));
  });
  it("같은 권한키의 면 하나만 새 탭으로 이동하고 권한키/주소는 보존한다", () => {
    const result = hubGroupsFor(all, { ...gate, menuLayout: menus, groupLayout: groups });
    expect(result.find((g) => g.id === "custom-desk")?.items[0]).toMatchObject({ href: "/attendance/live", label: "운영비", icon: "star", menuKey: "attendance" });
    expect(result.find((g) => g.id === "class")?.items.map((d) => d.href)).toContain("/attendance");
    expect(result.flatMap((g) => g.items).filter((d) => d.href === "/attendance/live")).toHaveLength(1);
  });
  it("원래 이름과 바꾼 이름을 모두 검색하며 현재 위치는 옮긴 면의 새 그룹이다", () => {
    const result = configuredHubGroups(all, menus, groups);
    const dest = result.find((g) => g.id === "custom-desk")!.items[0];
    expect(hubSearchKeywords(dest, "교무실")).toContain("운영비");
    expect(hubSearchKeywords(dest, "교무실")).toContain("오늘 출결");
    expect(hubGroupOfPath("/attendance/live?embed=1&date=2026-09-01", result)?.id).toBe("custom-desk");
    expect(hubGroupOfPath("/attendance?month=2026-09", result)?.id).toBe("class");
  });
  it("메뉴를 옮겨도 권한이 없으면 그룹까지 사라진다", () => {
    const matrix = resolveMatrix([{ menu: "attendance", role: "manager", access: "none" }]);
    const result = hubGroupsFor(all, { systemRole: "manager", permMatrix: matrix, menuLayout: menus, groupLayout: groups });
    expect(result.some((g) => g.id === "custom-desk")).toBe(false);
  });
  it("담당 반 조건은 이동 후에도 유지된다", () => {
    const moved = [{ href: "/attendance/quick", groupId: "custom-desk" }];
    const result = hubGroupsFor(all, { ...gate, canTeacherView: false, menuLayout: moved, groupLayout: groups });
    expect(result.flatMap((g) => g.items).some((d) => d.href === "/attendance/quick")).toBe(false);
  });
  it("고정 항목은 저장값 변조로 이동·개명·숨김할 수 없다", () => {
    const result = hubGroupsFor(all, { ...gate, menuLayout: [{ href: "/dashboard", label: "가짜", groupId: "custom-desk", hidden: true }], groupLayout: [{ id: "dashboard", label: "가짜", hidden: true }, ...groups] });
    expect(result[0]).toMatchObject({ id: "dashboard", label: "대시보드" });
    expect(result[0].items[0].label).toBe("대시보드");
  });
  it("감춘 그룹의 메뉴는 검색/자주 방문 목록에서도 빠지고 옮기면 다시 나온다", () => {
    const hidden = [{ id: "class", hidden: true }, ...groups];
    expect(frequentFor({ ...gate, groupLayout: hidden }, ["timetable"])).toEqual([]);
    expect(frequentFor({ ...gate, groupLayout: hidden, menuLayout: [{ href: "/timetable", groupId: "custom-desk", label: "일정판", icon: "star" }] }, ["timetable"])[0]).toMatchObject({ label: "일정판", icon: "star" });
  });
  it("코드에 새로 생긴 목적지는 설정된 순서 뒤에 자동으로 보인다", () => {
    const source = [{ id: "example", label: "예시", icon: "book" as const, kind: "hub" as const, items: all.find((g) => g.id === "class")!.items.slice(0, 3) }];
    const result = configuredHubGroups(source, [{ href: source[0].items[1].href, order: 0 }]);
    expect(result[0].items.map((d) => d.href)).toEqual([source[0].items[1].href, source[0].items[0].href, source[0].items[2].href]);
  });
  it("원장 전용·일반판 전용 조건은 원본에서 결정된다", () => {
    const matrix = resolveMatrix(MENU_KEYS.map((menu) => ({ menu, role: "admin" as const, access: "full" as const })));
    const result = hubGroupsFor(all, { systemRole: "admin", permMatrix: matrix, isMaster: false, isGenericTenant: false });
    expect(result.flatMap((g) => g.items).map((d) => d.href)).not.toContain("/owner?tab=audit");
    expect(result.flatMap((g) => g.items).map((d) => d.href)).not.toContain("/owner?tab=modules");
  });
});

describe("저장 검증·손상값·이전 화면·초기화", () => {
  it.each([
    { menus: [{ href: "/dashboard", hidden: true }] },
    { menus: [{ href: "/support", label: "다른 이름" }] },
    { menus: [{ href: "/students", icon: "unknown" }] },
    { menus: [{ href: "/students", groupId: "missing" }] },
    { menus: [{ href: "/students", groupId: "owner" }] },
    { menus: [{ href: "/students", label: " " }] },
    { menus: [], groups: [{ id: "class" }, { id: "class" }] },
    { menus: [], groups: [{ id: "custom-new" }] },
    { menus: [{ href: "/not-a-menu", label: "외부 메뉴" }] },
  ])("잘못된 저장 거부: %j", (value) => expect(navigationSchema.safeParse(value).success).toBe(false));
  it("없는 배열·중복·손상 아이콘·고정 항목 변조를 안전하게 읽는다", () => {
    expect(normalizeMenuRows([null, { href: "//external" }, { href: "/students", icon: "unknown" }, { href: "/students", label: "중복" }])).toEqual([{ href: "/students" }]);
    expect(normalizeGroupRows([null, { id: "owner", hidden: true }])).toEqual([]);
    const result = resolveSettings({ navigation: { menus: null, groups: "broken", teacherMenus: [] } }, { name: "테스트" });
    expect(result.navigation).toEqual({ menus: [], groups: [], teacherMenus: [], teacherGroups: [] });
  });
  it("구버전 화면 저장은 새 그룹·이름·아이콘·소속과 강사 구성을 보존한다", () => {
    const stored = { menus, groups, teacherMenus: [{ href: "/students", hidden: true }] };
    const raw = { menus: [{ href: "/attendance/live", hidden: true }] };
    const saved = prepareSectionForSave("chinsan", "navigation", raw, navigationSchema.parse(raw), stored) as typeof stored;
    expect(saved.groups).toEqual(groups);
    expect(saved.teacherMenus).toEqual(stored.teacherMenus);
    expect(saved.menus[0]).toMatchObject({ href: menus[0].href, label: "운영비", icon: "star", groupId: "custom-desk", hidden: true });
    expect(saved.menus[0].order).toBeUndefined();
  });
  it("관리자 초기화는 명시적 빈 배열이고 강사 구성에는 영향이 없다", () => {
    const teacherMenus = [{ href: "/students", hidden: true }];
    const reset = { menus: [], groups: [], teacherMenus };
    expect(prepareSectionForSave("generic", "navigation", reset, navigationSchema.parse(reset), { menus, groups, teacherMenus })).toEqual(reset);
  });
  it("서로 다른 학원의 해석과 기본 원본에 참조 변이가 없다", () => {
    const a = resolveSettings({ navigation: { menus, groups } }, { name: "A" });
    const b = resolveSettings({}, { name: "B" });
    expect(a.navigation.menus[0].label).toBe("운영비");
    expect(b.navigation.menus).toEqual([]);
    expect(all.find((g) => g.id === "class")!.items.some((d) => d.label === "운영비")).toBe(false);
  });
  it("🔴 화면 안 내부 탭(수납의 환불·계산기·회차 확정 · 셔틀 · 수업보고서 설정 면)의 옛 줄은 읽을 때 지워진다 — 메뉴가 아니라 저장을 막지 않는다(원장 2026-10-14)", () => {
    const raw = { menus: [{ href: "/billing?tab=refunds", label: "운영비", groupId: "custom-desk" }, { href: "/shuttle/today", hidden: true }, { href: "/lesson-reports?tab=ai_ment", order: 0 }, { href: "/billing", order: 1 }, { href: "/billing?tab=expenses", label: "지출 결의" }], groups };
    const normalized = normalizeNavigationSettings(raw);
    // 교재·지출은 메뉴 버튼이라(원장 2026-10-15) 그 줄은 남는다.
    expect(normalized.menus).toEqual([{ href: "/billing", order: 1 }, { href: "/billing?tab=expenses", label: "지출 결의" }]);
    expect(navigationSchema.safeParse(normalized).success).toBe(true);
  });
  it("폐기된 메뉴·그룹과 없는 소속을 정리한 뒤 저장 검증과 baseline이 일치한다", () => {
    const raw = { menus: [{ href: "/retired", label: "옛 메뉴" }, { href: "/students", groupId: "retired" }], groups: [{ id: "retired", label: "옛 탭" }] };
    const normalized = normalizeNavigationSettings(raw);
    expect(normalized.menus).toEqual([{ href: "/students" }]);
    expect(normalized.groups).toEqual([]);
    expect(navigationSchema.safeParse(normalized).success).toBe(true);
    expect(navigationRevision(raw)).toBe(navigationRevision(normalized));
  });
  it("감사로그는 주소나 그룹 ID 대신 실제 이름과 바뀐 속성을 기록한다", () => {
    const result = diffSettingsSection("navigation", { menus: [], groups: [] }, { menus, groups });
    const text = JSON.stringify(result);
    expect(text).toContain("운영비"); expect(text).toContain("아이콘 변경");
    expect(text).not.toContain("custom-desk"); expect(text).not.toContain("/attendance/live");
  });
});
