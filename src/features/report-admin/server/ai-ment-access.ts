import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { isFeatureLicensed } from "@/lib/license/server";

/** AI 멘트 메뉴의 조회·변경은 같은 권한과 학원 기능 설정을 따른다. */
export async function requireAiMentAccess(write = false) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" } as const;
  const allowed = write ? canWriteTenant : canAccessTenant;
  if (!(await allowed(user.systemRole, "ai_ment"))) return { error: "AI 멘트 권한이 없습니다" } as const;
  if (!(await isFeatureLicensed(user.tenantId, "ai_analysis"))) return { error: "사용할 수 없는 기능입니다" } as const;
  return { user } as const;
}
