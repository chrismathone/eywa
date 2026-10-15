import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView } from "@/lib/auth/view-mode";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { studentStatusManagerIds } from "@/features/owner/student-status-permissions";
import { canManageStudentStatus } from "../status-access";

export const canManageStudentStatusNow = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  const [readonly, tenantView, full] = await Promise.all([
    isReadonlyTeacherView(), isTenantViewWriteBlocked(), canManageTenant(user.systemRole, "students"),
  ]);
  if (readonly || tenantView || !full) return false;
  const [privileged, settings] = await Promise.all([isCurrentUserSuperAdmin(), getTenantSettings()]);
  return canManageStudentStatus(user, privileged, studentStatusManagerIds(settings.permissions.specialAccess));
});

/** Existing maintenance tools keep their legacy admin-menu contract until explicit transition. */
export const canManageAdministrativeStudentStatusNow = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user || await isReadonlyTeacherView() || await isTenantViewWriteBlocked()) return false;
  const settings = await getTenantSettings();
  if (studentStatusManagerIds(settings.permissions.specialAccess) === undefined) return true;
  return canManageStudentStatusNow();
});
