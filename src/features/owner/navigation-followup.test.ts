import { describe, expect, it } from "vitest";
import { configuredHubGroups } from "@/lib/menu-hub";
import { TEACHER_MENU_KEYS } from "@/lib/permissions";
import { teacherNavigationFor, teacherNavigationSource } from "@/lib/teacher-navigation";
import { toUsageRows } from "@/features/usage/ingest";
import { routeLabel, usageMenuLabel } from "@/features/usage/labels";
import { menuMentionDestination, menuMentionToken, parseMenuMentions, sameMenuMentions } from "./menu-mentions";
import { navigationSchema } from "./settings-types";
import { normalizeNavigationSettings, navigationRevision } from "./normalize-navigation";
import { prepareSectionForSave } from "./preset";
import { resolveSettings } from "./resolve";
import { placeNavigationGroup, placeNavigationMenu } from "./navigation-placement";
import { diffSettingsSection } from "./settings-diff";
import type { MenuGroupLayoutRow, MenuLayoutRow } from "./menu-layout";

const teacherGroups: MenuGroupLayoutRow[] = [{ id: "custom-lessons", label: "수업 준비", icon: "folder", order: 0 }];
const teacherMenus: MenuLayoutRow[] = [{ href: "/timetable", label: "우리 일정", icon: "star", groupId: "custom-lessons", order: 0 }];
const stored = { menus: [{ href: "/students", label: "관리자 명부" }], groups: [], teacherMenus, teacherGroups };

describe("강사 폴더 구성의 저장과 소비", () => {
  it("스키마 → 읽기 → 소비처가 이름·아이콘·주소를 보존한다", () => {
    const settings = resolveSettings({ navigation: navigationSchema.parse(stored) }, { name: "학원 A" });
    const result = teacherNavigationFor({ menus: TEACHER_MENU_KEYS, layout: settings.navigation.teacherMenus, groups: settings.navigation.teacherGroups });
    expect(result.grouped).toBe(true);
    expect(result.groups[0]).toMatchObject({ id: "custom-lessons", label: "수업 준비", items: [{ href: "/timetable", menuKey: "timetable", label: "우리 일정", icon: "star" }] });
    expect(settings.navigation.menus).toEqual(stored.menus);
    expect(resolveSettings({}, { name: "학원 B" }).navigation.teacherGroups).toEqual([]);
  });
  it("숨긴 폴더에 숨긴 홈을 넣어도 홈은 남고 권한·담당 과목은 우회하지 않는다", () => {
    const layout = [{ href: "/ecs", groupId: "custom-lessons", hidden: true }];
    const groups = [{ ...teacherGroups[0], hidden: true }];
    const options = { menus: TEACHER_MENU_KEYS, layout, groups, home: "/ecs" };
    expect(teacherNavigationFor(options).home?.href).toBe("/ecs");
    expect(teacherNavigationFor({ ...options, showEcs: false }).home).toBeNull();
    expect(teacherNavigationFor({ ...options, menus: [] }).home).toBeNull();
  });
  it("폴더 이동 후에도 담당 과목·허용 메뉴만 보이고 빈 폴더는 사라진다", () => {
    const options = { layout: [...teacherMenus, { href: "/mcs", groupId: "custom-lessons" }], groups: teacherGroups };
    const english = teacherNavigationFor({ ...options, menus: ["timetable", "mcs"], showMcs: false });
    expect(english.groups.flatMap((g) => g.items).map((d) => d.href)).toEqual(["/timetable"]);
    expect(teacherNavigationFor({ ...options, menus: [] }).groups).toEqual([]);
  });
  it("기본은 평면 목록이며 기본 이름만 번역한다", () => {
    const empty = teacherNavigationFor({ menus: TEACHER_MENU_KEYS, lang: "en", home: "/onescreen" });
    expect(empty.grouped).toBe(false);
    expect(empty.home?.href).toBe("/onescreen");
    expect(empty.groups.flatMap((g) => g.items).find((d) => d.href === "/timetable")?.label).toBe("Timetable");
    expect(teacherNavigationFor({ menus: TEACHER_MENU_KEYS, lang: "en", layout: teacherMenus, groups: teacherGroups }).groups[0].items[0].label).toBe("우리 일정");
  });
  it.each([
    { teacherMenus: [{ href: "/billing", label: "권한 추가 시도" }] },
    { teacherMenus: [{ href: "/timetable", groupId: "class" }] },
    { teacherMenus: [], teacherGroups: [{ id: "owner", label: "설정" }] },
    { teacherMenus: [], teacherGroups: [{ id: "custom-a" }] },
    { teacherMenus: [], teacherGroups: [teacherGroups[0], teacherGroups[0]] },
  ])("강사 목록 밖 목적지와 잘못된 그룹을 거부한다: %j", (value) => {
    expect(navigationSchema.safeParse({ menus: [], ...value }).success).toBe(false);
  });
  it("구버전 강사 초기화는 숨김·순서만 지우고 새 표시 속성과 폴더는 보존한다", () => {
    const raw = { menus: stored.menus, teacherMenus: [] };
    const next = prepareSectionForSave("generic", "navigation", raw, navigationSchema.parse(raw), { ...stored, teacherMenus: [...teacherMenus, { href: "/ecs", hidden: true }] }) as typeof stored;
    expect(next.teacherGroups).toEqual(teacherGroups);
    expect(next.teacherMenus).toEqual([{ href: "/timetable", label: "우리 일정", icon: "star", groupId: "custom-lessons" }]);
  });
  it("새 화면의 강사 초기화는 폴더까지 비우고 관리자 설정을 보존한다", () => {
    const raw = { ...stored, teacherMenus: [], teacherGroups: [] };
    expect(prepareSectionForSave("generic", "navigation", raw, navigationSchema.parse(raw), stored)).toEqual(raw);
  });
  it("강사 필드가 모두 빠진 옛 화면은 저장된 강사 구성을 통째로 보존한다", () => {
    const raw = { menus: [] };
    const next = prepareSectionForSave("generic", "navigation", raw, navigationSchema.parse(raw), stored) as typeof stored;
    expect(next.teacherMenus).toEqual(teacherMenus);
    expect(next.teacherGroups).toEqual(teacherGroups);
  });
  it("폐기된 목적지·소속은 정리하고 강사 수정도 revision과 감사로그에 남는다", () => {
    const result = normalizeNavigationSettings({ ...stored, teacherMenus: [{ href: "/retired", label: "폐기" }, { href: "/timetable", groupId: "missing" }] });
    expect(result.teacherMenus).toEqual([{ href: "/timetable" }]);
    expect(navigationRevision(stored)).not.toBe(navigationRevision({ ...stored, teacherGroups: [{ ...teacherGroups[0], label: "교무" }] }));
    const log = JSON.stringify(diffSettingsSection("navigation", { menus: [], teacherMenus: [], teacherGroups: [] }, stored));
    expect(log).toContain("우리 일정"); expect(log).toContain("수업 준비");
    expect(log).not.toContain("custom-lessons"); expect(log).not.toContain("/timetable");
  });
});

describe("폴더 드롭의 공통 배치 경로", () => {
  const groups = configuredHubGroups(teacherNavigationSource(), teacherMenus, teacherGroups, true);
  it("그룹 간 이동은 한 번만 담고 표시 속성을 보존하며 숨김을 해제한다", () => {
    const rows = [...teacherMenus, { href: "/students", label: "내 원생", icon: "star" as const, hidden: true }];
    const moved = placeNavigationMenu(rows, groups, "/students", "custom-lessons", { href: "/timetable", edge: "before" });
    expect(moved.filter((r) => r.href === "/students")).toEqual([{ href: "/students", label: "내 원생", icon: "star", hidden: false, groupId: "custom-lessons", order: 0 }]);
    expect(moved.find((r) => r.href === "/timetable")?.order).toBe(1);
    expect(rows.find((r) => r.href === "/students")?.hidden).toBe(true);
  });
  it("없는 대상·앵커·숨긴 폴더·자기 자신 드롭은 변경하지 않는다", () => {
    expect(placeNavigationMenu(teacherMenus, groups, "/timetable", "missing")).toBe(teacherMenus);
    expect(placeNavigationMenu(teacherMenus, groups, "/timetable", "teacher-main", { href: "/missing", edge: "before" })).toBe(teacherMenus);
    expect(placeNavigationMenu(teacherMenus, groups, "/timetable", "custom-lessons", { href: "/timetable", edge: "before" })).toBe(teacherMenus);
    expect(placeNavigationMenu(teacherMenus, groups.map((g) => ({ ...g, hidden: true })), "/students", "custom-lessons")).toBe(teacherMenus);
  });
  it("폴더 정렬도 기존 이름·아이콘을 보존한다", () => {
    const next = placeNavigationGroup(teacherGroups, groups, "teacher-main", "custom-lessons", "before");
    expect(next.find((r) => r.id === "teacher-main")?.order).toBe(0);
    expect(next.find((r) => r.id === "custom-lessons")).toMatchObject({ label: "수업 준비", icon: "folder", order: 1 });
  });
});

describe("기본 통계와 안정적인 @메뉴 참조", () => {
  it("표시 이름·폴더 변경과 무관하게 서버는 기본 메뉴 키로 합산한다", () => {
    const dest = teacherNavigationFor({ menus: TEACHER_MENU_KEYS, layout: teacherMenus, groups: teacherGroups }).groups[0].items[0];
    const rows = toUsageRows([{ route: dest.href, visits: 1, openSec: 3, activeSec: 2 }, { route: "/timetable", visits: 1, openSec: 5, activeSec: 4 }]);
    expect(rows).toEqual([{ route_key: "/timetable", menu_key: "timetable", visits: 2, open_seconds: 8, active_seconds: 6 }]);
    expect(usageMenuLabel(rows[0].menu_key)).toBe("시간표");
    expect(routeLabel(rows[0].route_key)).toBe("시간표");
  });
  it("본문과 반복 참조·쿼리 면을 잃지 않고 기본 목적지로 복원한다", () => {
    const token = menuMentionToken("/billing?tab=expenses");
    expect(parseMenuMentions(`앞 ${token}\n${token} 뒤`)).toEqual([
      { type: "text", text: "앞 " }, { type: "menu", href: "/billing?tab=expenses", label: menuMentionDestination("/billing?tab=expenses")!.label },
      { type: "text", text: "\n" }, { type: "menu", href: "/billing?tab=expenses", label: menuMentionDestination("/billing?tab=expenses")!.label }, { type: "text", text: " 뒤" },
    ]);
    expect(parseMenuMentions("support@example.com @시간표")).toEqual([{ type: "text", text: "support@example.com @시간표" }]);
    expect(menuMentionToken("//example.com")).toBe("");
    expect(menuMentionDestination("javascript:alert(1)")).toBeUndefined();
  });
  it("영문 번역은 참조 순서를 바꿀 수 있지만 목적지·개수를 바꾸면 거부한다", () => {
    const a = menuMentionToken("/timetable"); const b = menuMentionToken("/students");
    expect(sameMenuMentions(`${a}와 ${b}`, `${b} and ${a}`)).toBe(true);
    expect(sameMenuMentions(`${a} ${a}`, a)).toBe(false);
    expect(sameMenuMentions(a, b)).toBe(false);
    expect(sameMenuMentions(a, "Timetable updated")).toBe(false);
  });
});
