/**
 * '탭 및 메뉴 구성' 편집기가 보여 주는 메뉴 — 순수(Vitest).
 *
 * 원장 2026-10-14 *"내부 탭에 있는 메뉴는 따로 탭 및 메뉴 구성에 넣지 말것. 없는 메뉴 (접근할 수 없는)"*:
 *  · **내부 탭** = 다른 화면 위 탭바로 오가는 면. 관리자뷰는 목록 자체에서 뺐다(`menu-hub.ts` `INNER_TABS`).
 *    강사뷰의 '설정' 폴더(학원 설정 · 수업보고서 · 수납의 설정 면)도 같은 것이라 편집기에 세우지 않는다 — 폴더는 그대로 남아
 *    그 설정을 맡은 선생님에게만 선다(`teacherNavigationFor`가 권한으로 거른다).
 *  · **없는 메뉴** = 아무도 열 수 없는 메뉴. 관리자뷰 = 이 지점에서 닫힌 메뉴(꺼 둔 기능 · 보강 모드 · 실험실 · 라이선스 — 원장·개인 예외로도
 *    안 열린다, `tenantClosedMenus`) + 역할 전용 화면(선생님 원스크린 · 내 학습 — 관리자 화면에선 누구에게도 서지 않는다).
 *    강사뷰 = 위 닫힘 + 강사 역할에 꺼진 메뉴 — 단 개인별 메뉴 권한으로 강사 계정에게 연 메뉴는 남긴다(그 선생님에게는 실제로 선다).
 * 🔴 관리자뷰를 역할 권한으로 거르지 말 것 — 직원 평가·전자결재는 기본값이 전 역할 '없음'이고 개인별 권한으로만 연다.
 * ⚠️ 편집기에서 뺄 뿐 저장값은 건드리지 않는다(편집기는 고친 줄만 다시 쓴다). 권한 표는 이 목록을 읽지 않는다(`permission-rows.ts`).
 */
import { HUB_GROUPS, SUPPORT_GROUPS, type HubGroup } from "@/lib/menu-hub";
import { isRoleOnlyMenu, type Access, type MenuKey } from "@/lib/permissions";
import { TEACHER_NAV_GROUPS, TEACHER_SETTINGS_GROUP } from "@/lib/teacher-navigation";

// 함께 열려야 하는 권한(`alsoNeeds` — 셔틀 관리자 화면은 셔틀 권한 위 조건, 2026-11-10)이 닫혀도 뺀다(메뉴 판 `allowed`와 같은 판정).
const keepItems = (groups: readonly HubGroup[], keep: (menu: MenuKey) => boolean): HubGroup[] =>
  groups.map((g) => ({ ...g, items: g.items.filter((d) => keep(d.menuKey) && (!d.alsoNeeds || keep(d.alsoNeeds))) }));

/** 관리자뷰 편집기의 메뉴 — 지점에서 닫힌 메뉴와 역할 전용 화면만 뺀다. 탭(업무군)은 비어도 남긴다(원장이 옮겨 담은 메뉴가 그 탭에 있을 수 있다). */
export function adminEditorSource(closed: readonly MenuKey[] = []): HubGroup[] {
  const shut = new Set(closed);
  return keepItems([...HUB_GROUPS, ...SUPPORT_GROUPS], (menu) => !shut.has(menu) && !isRoleOnlyMenu(menu));
}

/** 개인별 메뉴 권한으로 연 메뉴(호출부가 강사 계정 줄만 넘긴다) — 지점에서 닫힌 메뉴는 개인 예외로도 안 열리므로 뺀다. */
export function personallyOpenedMenus(
  userOverrides: readonly { menu: MenuKey; access: Access }[],
  closed: readonly MenuKey[] = [],
): MenuKey[] {
  const shut = new Set(closed);
  return [...new Set(userOverrides.filter((r) => r.access !== "none" && !shut.has(r.menu)).map((r) => r.menu))];
}

/** 강사뷰 편집기의 메뉴 — '설정' 폴더를 빼고, 강사 역할로 열리거나 개인별로 연 메뉴만 남긴다. */
export function teacherEditorSource(teacherOpen: readonly MenuKey[], personal: readonly MenuKey[] = []): HubGroup[] {
  const open = new Set([...teacherOpen, ...personal]);
  return keepItems(TEACHER_NAV_GROUPS.filter((g) => g.id !== TEACHER_SETTINGS_GROUP), (menu) => open.has(menu));
}
