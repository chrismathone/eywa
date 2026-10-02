"use server";
import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { tenantSettingsTag } from "./queries";
import { resolveSettings } from "../resolve";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { SETTINGS_ROLE_GROUPS, type SettingsRoleGroup } from "@/lib/settings-role-catalog";
import { applySettingRoles, settingRoleSelection, type SettingRoleSelection } from "../setting-roles";

const roleList = z.array(z.enum(SYSTEM_ROLES)).max(SYSTEM_ROLES.length)
  .refine(roles => !roles.includes("student") && roles.includes("master"), "원장은 유지하고 직원 직급만 선택해 주세요");

export async function saveSettingRoles(group: SettingsRoleGroup, input: SettingRoleSelection, baseline: string): Promise<{ error?: string; selection?: SettingRoleSelection }> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if ((actor.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) || await isReadonlyTeacherView()) {
    return { error: "원장과 슈퍼관리자만 역할을 설정할 수 있습니다" };
  }
  if (!Object.hasOwn(SETTINGS_ROLE_GROUPS, group)) return { error: "역할 설정 대상을 확인해 주세요" };
  const menus = SETTINGS_ROLE_GROUPS[group];
  const schema = z.object(Object.fromEntries(menus.map(menu => [menu, roleList]))).strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "직급 선택을 확인해 주세요" };
  // 원장·슈퍼관리자만 통과하며, 대상 학원과 수정 가능한 설정 키를 서버에서 정한다.
  const db = createAdminClient();
  const { data: row, error } = await db.from("tenant_settings").select("data, updated_at").eq("tenant_id", actor.tenantId).maybeSingle();
  if (error || !row) return { error: "현재 역할 설정을 불러오지 못했습니다" };
  const settings = resolveSettings(row.data, { name: "" });
  const before = settingRoleSelection(group, settings.permissions.overrides);
  if (JSON.stringify(before) !== baseline) return { error: "다른 창에서 역할을 변경했습니다. 새로고침한 뒤 다시 설정해 주세요." };
  const overrides = applySettingRoles(group, settings.permissions.overrides, parsed.data);
  const next = { ...row.data, permissions: { ...row.data.permissions, overrides } };
  const write = await db.from("tenant_settings").update({ data: next, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq("tenant_id", actor.tenantId).eq("updated_at", row.updated_at).select("tenant_id");
  if (write.error) return { error: "역할 설정을 저장하지 못했습니다" };
  if (!write.data?.length) return { error: "다른 창에서 설정이 변경되었습니다. 새로고침해 주세요." };
  const selection = settingRoleSelection(group, overrides);
  await logAction({ action: "owner_settings_update", targetType: "tenant_settings", targetLabel: "설정별 역할", metadata: { section: "permissions", group, before, after: selection } });
  updateTag(tenantSettingsTag(actor.tenantId));
  revalidatePath("/", "layout");
  return { selection };
}
