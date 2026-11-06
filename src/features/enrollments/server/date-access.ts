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

/**
 * 세 화면과 저장 액션이 같은 문을 사용한다. 보기 전용 전환 중에는 지정되어 있어도 수정하지 않는다.
 * 🔑 명단(학원 설정 '수강 날짜 수정' 지정)·원장 판정·담당 반은 모두 **화면 주인** — 강사뷰(다른 강사 뷰)면 검증된
 *    대상이다. 메뉴 수준은 이미 대상 것인데 명단만 실제 계정으로 보면 지정받은 강사 X의 화면에서 편집이 닫히고,
 *    지정받지 않은 X의 화면이 실제 계정의 지정으로 열렸다(2026-11-05 강사뷰 신원 점검).
 * ⚠️ DB 가드(student_status_private.date_allowed)는 여전히 auth.uid()=실제 계정으로 본다 — 보고서 '필요 SQL'.
 */
export const getEnrollmentDateAccess = cache(async (): Promise<EnrollmentDateAccess> => {
  const denied: EnrollmentDateAccess = { allowed: false, classIds: [] };
  const user = await getCurrentUser({ teacherView: true });
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
  return { allowed: true, classIds: await teacherViewableClassIds(user.id) };
});

export async function canEditEnrollmentDatesNow(): Promise<boolean> {
  return (await getEnrollmentDateAccess()).allowed;
}
