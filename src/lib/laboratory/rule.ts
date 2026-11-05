import { isConnectedAppMenu, MENU_KEYS, MENU_LABEL, SYSTEM_ROLES, type AccessMatrix, type MenuKey } from "@/lib/permissions";

// Keep landing, support, and account-management routes available for recovery.
// Settings permissions (including kiosk_settings) are independent menu gates and belong here.
// 연결 앱 권한(app_* · 2026-11-05)은 메뉴 화면이 아니라 바깥 앱 링크다 — 지점 스위치로 켜고 끄므로 실험실 배정 대상이 아니다.
const EXCLUDED = new Set<MenuKey>(["dashboard", "owner", "admin", "help", "support", "teacher_view", "teacher_onescreen", "my_learning"]);
export const LAB_ELIGIBLE_MENUS = MENU_KEYS.filter((key) => !EXCLUDED.has(key) && !isConnectedAppMenu(key)).map((key) => ({
  key,
  label: key === "kiosk_settings" ? "출석 키오스크" : MENU_LABEL[key],
}));
export const LAB_ELIGIBLE_KEYS = new Set<MenuKey>(LAB_ELIGIBLE_MENUS.map((item) => item.key));

export function capLaboratoryMenus(matrix: AccessMatrix, assigned: readonly MenuKey[], enabled: boolean): AccessMatrix {
  if (enabled || assigned.length === 0) return matrix;
  const result = { ...matrix };
  for (const key of assigned) {
    result[key] = Object.fromEntries(SYSTEM_ROLES.map((role) => [role, "none"])) as AccessMatrix[MenuKey];
  }
  return result;
}
