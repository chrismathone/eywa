import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { canSplitClass } from "../access";

/**
 * 수업 나누기 게이트 — **시간표 팝업(보이기)과 서버 액션(쓰기)이 이 함수 하나를 쓴다**([[#77]]).
 * 🔴 '다른 강사 뷰'(열람 전용)에선 누구도 못 나눈다(view-as.ts — 쓰기 전면 차단 규약).
 */
export async function canSplitClassNow(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (await isReadonlyTeacherView()) return false;
  const [isSuperAdmin, settings] = await Promise.all([isCurrentUserSuperAdmin(), getTenantSettings()]);
  return canSplitClass(user, { isSuperAdmin, isChinsanTenant: isChinsanTenant(settings) });
}
