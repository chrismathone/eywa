import { resolveMatrix, SYSTEM_ROLES, type PermissionOverride, type SystemRole } from "@/lib/permissions";
import { SETTINGS_ROLE_GROUPS, type SettingsRoleGroup, type SettingsRoleKey } from "@/lib/settings-role-catalog";

export const SETTING_ROLES = SYSTEM_ROLES.filter(role => role !== "student");
export type SettingRoleSelection = Partial<Record<SettingsRoleKey, SystemRole[]>>;

export function settingRoleSelection(group: SettingsRoleGroup, overrides: readonly PermissionOverride[]): SettingRoleSelection {
  const matrix = resolveMatrix(overrides);
  return Object.fromEntries(SETTINGS_ROLE_GROUPS[group].map(menu => [menu,
    SETTING_ROLES.filter(role => matrix[menu][role] !== "none"),
  ]));
}

/** 허용한 설정 항목만 교체하고 다른 메뉴·개인 예외는 보존한다. */
export function applySettingRoles(group: SettingsRoleGroup, overrides: readonly PermissionOverride[], selection: SettingRoleSelection): PermissionOverride[] {
  const menus: readonly SettingsRoleKey[] = SETTINGS_ROLE_GROUPS[group];
  const matrix = resolveMatrix(overrides);
  return [
    ...overrides.filter(row => !menus.includes(row.menu as SettingsRoleKey)),
    ...menus.flatMap(menu => SETTING_ROLES.map(role => ({
      menu, role,
      access: selection[menu]?.includes(role)
        ? (matrix[menu][role] === "none" ? "full" : matrix[menu][role])
        : "none",
    } as PermissionOverride))),
  ];
}
