import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView } from "@/lib/auth/view-mode";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { teacherViewableClassIds } from "@/features/students/server/read-scope";
import { canEditEnrollmentDates, type EnrollmentDateAccess } from "../date-access";

const DATE_MENUS = ["students", "classes", "withdrawals"] as const;

/** 세 화면과 저장 액션이 같은 문을 사용한다. 보기 전용 전환 중에는 지정되어 있어도 수정하지 않는다. */
export const getEnrollmentDateAccess = cache(async (): Promise<EnrollmentDateAccess> => {
  const denied: EnrollmentDateAccess = { allowed: false, classIds: [] };
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return denied;
  const [readonly, tenantView] = await Promise.all([isReadonlyTeacherView(), isTenantViewWriteBlocked()]);
  if (readonly || tenantView) return denied;
  const [privileged, settings, menus] = await Promise.all([
    isCurrentUserSuperAdmin(),
    getTenantSettings(),
    Promise.all(DATE_MENUS.map((menu) => accessLevelTenant(user.systemRole, menu))),
  ]);
  if (!menus.some((level) => level !== "none") || !canEditEnrollmentDates(user, privileged, settings.permissions.specialAccess.enrollmentDateEditorIds)) return denied;
  // 기능 지정은 기존 메뉴의 담당 범위를 넓히지 않는다. 조회 실패 시 범위를 추측해 허용하지 않는다.
  if (menus.some((level) => level === "full" || level === "readonly")) return { allowed: true, classIds: null };
  const viewing = await getCurrentUser({ teacherView: true });
  return { allowed: true, classIds: viewing ? await teacherViewableClassIds(viewing.id) : [] };
});

export async function canEditEnrollmentDatesNow(): Promise<boolean> {
  return (await getEnrollmentDateAccess()).allowed;
}
