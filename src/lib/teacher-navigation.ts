import { configuredHubGroups, type HubGroup } from "./menu-hub";
import { isTeacherMenuEntranceOpen } from "./navigation";
import { TEACHER_MENU_LINKS } from "./teacher-menu-links";
import { MENU_LABEL, type MenuKey } from "./permissions";
import { SETTINGS_ROLE_HREF, SETTINGS_ROLE_KEYS } from "./settings-role-catalog";
import { MENU_ICON } from "@/components/icons/aywa-icons";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";
import { isMenuHiddenByLayout, type MenuGroupLayout, type MenuLayout } from "@/features/owner/menu-layout";

export const TEACHER_DEFAULT_GROUP = "teacher-main";

/** 강사 스코프가 있는 원본 목적지만 제공한다. 기본 라벨은 기존 한/영 사전을 따른다. */
export function teacherNavigationSource(lang: SheetLang = "ko"): HubGroup[] {
  return [{
    id: TEACHER_DEFAULT_GROUP, label: sheetT(lang, "menu.trigger"), icon: "folder", kind: "hub",
    items: TEACHER_MENU_LINKS.filter((l) => isTeacherMenuEntranceOpen(l.menu)).map((l) => ({
      href: l.href, menuKey: l.menu, label: sheetT(lang, l.labelKey), icon: l.icon,
    })),
  }, {
    id: "teacher-settings", label: "설정", icon: "settings", kind: "hub",
    items: SETTINGS_ROLE_KEYS.filter(key => key !== "attendance_salary_settings").map(menuKey => ({
      menuKey, href: SETTINGS_ROLE_HREF[menuKey], label: MENU_LABEL[menuKey], icon: MENU_ICON[menuKey],
    })),
  }];
}

export const TEACHER_NAV_GROUPS = teacherNavigationSource();

/** 실제 권한은 셸이 계산해 준 메뉴 키를 그대로 따른다. 배치로 권한이나 담당 과목을 만들지 않는다. */
export function teacherNavigationFor({ menus, layout, groups, home = null, showEcs = true, showMcs = true, lang = "ko" }: {
  menus: readonly MenuKey[]; layout?: MenuLayout; groups?: MenuGroupLayout;
  home?: string | null; showEcs?: boolean; showMcs?: boolean; lang?: SheetLang;
}) {
  const configured = configuredHubGroups(teacherNavigationSource(lang), layout, groups, true);
  const allowed = (key: MenuKey) => menus.includes(key) && (key !== "ecs" || showEcs) && (key !== "mcs" || showMcs);
  // 홈은 숨긴 그룹 안으로 옮겨도, 그 메뉴의 표시를 꺼도 남는다. 권한/담당 조건은 먼저 적용한다.
  const pinnedHome = configured.flatMap((g) => g.items).find((d) => d.href === home && allowed(d.menuKey)) ?? null;
  return {
    home: pinnedHome,
    groups: configured.filter((g) => !g.hidden).map((g) => ({
      ...g, items: g.items.filter((d) => d.href !== pinnedHome?.href && allowed(d.menuKey) && !isMenuHiddenByLayout(d.href, layout)),
    })).filter((g) => g.items.length > 0),
    // 기본값은 기존 평면 목록 그대로. 묶음을 편집한 학원부터 폴더를 표시한다.
    grouped: !!groups?.length || !!layout?.some((r) => r.groupId),
  };
}
