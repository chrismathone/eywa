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

/**
 * 원생 상태(휴원·퇴원) 변경 자격 — 명단·원장 판정은 **화면 주인**(강사뷰면 검증된 대상)으로 본다. 메뉴 수준(canManageTenant)은
 * 이미 대상 것이라, 명단만 실제 계정으로 보면 두 사람의 자격이 섞였다(2026-11-05 강사뷰 신원 점검).
 * ⚠️ DB 가드(student_status_private.allowed)는 auth.uid()=실제 계정으로 본다 — 보고서 '필요 SQL'.
 */
export const canManageStudentStatusNow = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser({ teacherView: true });
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
