import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canSplitClass } from "../access";

/**
 * 수업 나누기 게이트 — **시간표 팝업(보이기)과 서버 액션(쓰기)이 이 함수 하나를 쓴다**([[#77]]).
 * 🔴 '다른 강사 뷰'(열람 전용)에선 누구도 못 나눈다(view-as.ts — 쓰기 전면 차단 규약).
 * 🔴 **수업 관리 권한(전체)도 함께 본다** — 시간표는 그 권한이 있을 때만 나누기 팝업을 세운다(`page.tsx`의 `canEdit`).
 *    지정만 보고 통과시키면, 수업을 못 고치는 사람(강사 등)을 지정했을 때 화면엔 아무것도 없는데 요청을 만들어 나눌 수 있다.
 *    담당자는 원장이 화면에서 누구든 지정할 수 있다 — 지정은 '누가'이고, 수업을 바꿔도 되는지는 메뉴 권한이 정한다.
 */
export async function canSplitClassNow(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (await isReadonlyTeacherView()) return false;
  const [isSuperAdmin, settings, canManageClasses] = await Promise.all([
    isCurrentUserSuperAdmin(),
    getTenantSettings(),
    canManageTenant(user.systemRole, "classes"),
  ]);
  if (!canManageClasses) return false;
  return canSplitClass(user, { isSuperAdmin, splitterIds: settings.permissions.specialAccess.classSplitterIds });
}
