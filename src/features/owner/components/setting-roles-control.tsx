import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { isFeatureLicensed } from "@/lib/license/server";
import { getTenantSettings } from "../server/queries";
import { settingRoleSelection } from "../setting-roles";
import type { SettingsRoleGroup, SettingsRoleKey } from "@/lib/settings-role-catalog";
import { SettingRolesButton } from "./setting-roles-button";

/** 원장·슈퍼관리자에게만 표시하며 저장 액션도 같은 판정을 반복한다. */
export async function SettingRolesControl({ group }: { group: SettingsRoleGroup }) {
  const user = await getCurrentUser();
  if (!user || (user.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) || await isReadonlyTeacherView()) return null;
  const settings = await getTenantSettings();
  const hidden: SettingsRoleKey[] = [];
  if (group === "lesson_reports" && !(await isFeatureLicensed(user.tenantId, "ai_analysis"))) hidden.push("ai_ment");
  if (settings.modules.disabled.includes("payroll")) hidden.push("attendance_salary_settings", "payroll_settings");
  return <SettingRolesButton group={group} initial={settingRoleSelection(group, settings.permissions.overrides)} hidden={hidden} />;
}
