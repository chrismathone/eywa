import "server-only";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";

/**
 * 고객센터 메뉴에 **쓰기** 권한이 있으면 개선요청을 쓴다(makeedu도 지점 직원 누구나 쓴다).
 * 🔴 `canAccessTenant`로 바꾸지 말 것 — 읽기 전용(readonly)과 '다른 강사 뷰'(열람 전용)까지 통과해 버린다.
 */
export async function canWriteSupportRequest(role: SystemRole): Promise<boolean> {
  return canWriteTenant(role, "support");
}
