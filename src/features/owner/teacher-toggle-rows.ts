/**
 * 학원설정 '강사 내 메뉴 표시' 칸의 구성 — 강사 '내 메뉴'가 **실제로 서는 그대로**. 순수(Vitest).
 *
 * 칸의 단위는 권한 키다(그 칸을 끄면 강사의 그 권한이 '없음'이 된다). 칸의 차례와 이름은 강사 '내 메뉴'와 같은 해석
 * ([`teacherNavigationSource`](@/lib/teacher-navigation) + 강사뷰 구성)에서 나온다 — 전에는 권한 키 차례라 실제 메뉴와 달랐다.
 * 권한 표의 줄 구성([`permission-rows.ts`](./permission-rows.ts))과 짝이다.
 */
import { configuredHubGroups } from "@/lib/menu-hub";
import { isTeacherMenuEntranceOpen } from "@/lib/navigation";
import { MENU_ACCESS, MENU_LABEL, TEACHER_MENU_KEYS, type Access, type MenuKey } from "@/lib/permissions";
import { teacherNavigationSource } from "@/lib/teacher-navigation";
import { isMenuHiddenByLayout } from "./menu-layout";
import { isRenamedDest, renamedCovers, type PermissionNavigation } from "./permission-rows";

/** 이 칸들이 켜고 끄는 권한 — 강사 '내 메뉴'와 **같은 입구 정책**으로 거른다(메뉴에서 뺀 탭은 없다). */
export const TEACHER_TOGGLE_KEYS: readonly MenuKey[] = TEACHER_MENU_KEYS.filter(isTeacherMenuEntranceOpen);

export type TeacherToggleRow = {
  menu: MenuKey;
  label: string;
  /**
   * 강사뷰 구성에서 **이름을 바꾼** 입구의 바뀐 이름 — 그 밖엔 비운다. 칸은 권한 이름(탭 이름) 한 줄이 기본이다
   * (원장 2026-11-05 *"항상 탭 이름을 기본으로 가져가도록해"* — 권한 표 `permission-rows.ts`와 같은 규칙 · 같은 판정 `isRenamedDest`).
   * 전에는 '내 메뉴'에 서는 이름을 다 적었다(출석부 옆 '출결 모드 · 출석부', 원생목록 옆 '내 학생').
   */
  covers: string[];
  /** 강사뷰 구성에서 이 권한의 입구를 전부 감췄다 — 켜 두어도 '내 메뉴'에는 안 선다(주소로는 열린다). */
  hiddenInMenu: boolean;
};

/**
 * 칸의 차례 — 강사 '내 메뉴'가 서는 차례(강사뷰 구성) 그대로.
 * 홈(선생님 원스크린)은 '내 메뉴'에서 늘 맨 위라 여기서도 맨 앞에 둔다.
 */
export function teacherToggleRows(navigation?: PermissionNavigation): TeacherToggleRow[] {
  const teacherMenus = navigation?.teacherMenus;
  const found = new Map<MenuKey, { label: string; renamed: boolean; hidden: boolean }[]>();
  for (const g of configuredHubGroups(teacherNavigationSource(), teacherMenus, navigation?.teacherGroups, true)) {
    for (const d of g.items) {
      if (!TEACHER_TOGGLE_KEYS.includes(d.menuKey)) continue;
      found.set(d.menuKey, [
        ...(found.get(d.menuKey) ?? []),
        { label: d.label, renamed: isRenamedDest(d), hidden: g.hidden === true || isMenuHiddenByLayout(d.href, teacherMenus) },
      ]);
    }
  }
  // 입구 표에 줄이 없는 권한(있어서는 안 된다 — 가드가 잠근다)도 빠뜨리지 않고 끝에 세운다.
  const order = [...found.keys(), ...TEACHER_TOGGLE_KEYS.filter((menu) => !found.has(menu))];
  const rows = order.map((menu): TeacherToggleRow => {
    const dests = found.get(menu) ?? [];
    return {
      menu,
      label: MENU_LABEL[menu],
      covers: renamedCovers(dests, MENU_LABEL[menu]),
      // 홈은 감춰도 그 선생님에게 맨 위로 남는다(applyTeacherMenuLayout) — 감춤 표식을 달지 않는다.
      hiddenInMenu: menu !== "teacher_onescreen" && dests.length > 0 && dests.every((d) => d.hidden),
    };
  });
  return [...rows.filter((r) => r.menu === "teacher_onescreen"), ...rows.filter((r) => r.menu !== "teacher_onescreen")];
}

/**
 * 꺼져 있던 칸을 켤 때 강사에게 줄 수준 — 코드 기본값. 기본값이 '없음'인 메뉴(전자결재 · 직원 평가)는 **담당**으로 켠다.
 * 🔴 기본값을 그대로 쓰면 그 두 칸은 체크해도 '없음'으로 되돌아가 켜지지 않았다(체크박스가 눌리지 않는 것처럼 보였다).
 *    담당 = 강사의 보통 수준이다 — 직원 평가는 강사에게 자기 평가만, 전자결재는 자기 문서만 열린다(범위는 각 화면이 정한다).
 */
export function teacherToggleOnAccess(menu: MenuKey): Access {
  const base = MENU_ACCESS[menu].teacher;
  return base === "none" ? "scoped" : base;
}
