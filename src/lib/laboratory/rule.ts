import { MENU_KEYS, MENU_LABEL, SYSTEM_ROLES, type AccessMatrix, type MenuKey } from "@/lib/permissions";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";

// Keep recovery and account-management routes outside the laboratory catalog.
const EXCLUDED = new Set<MenuKey>(["dashboard", "owner", "admin", "help", "support", "teacher_view", "teacher_onescreen", "my_learning", ...SETTINGS_ROLE_KEYS]);
export const LAB_ELIGIBLE_MENUS = MENU_KEYS.filter((key) => !EXCLUDED.has(key)).map((key) => ({ key, label: MENU_LABEL[key] }));
export const LAB_ELIGIBLE_KEYS = new Set<MenuKey>(LAB_ELIGIBLE_MENUS.map((item) => item.key));

export function capLaboratoryMenus(matrix: AccessMatrix, assigned: readonly MenuKey[], enabled: boolean): AccessMatrix {
  if (enabled || assigned.length === 0) return matrix;
  const result = { ...matrix };
  for (const key of assigned) {
    result[key] = Object.fromEntries(SYSTEM_ROLES.map((role) => [role, "none"])) as AccessMatrix[MenuKey];
  }
  return result;
}
