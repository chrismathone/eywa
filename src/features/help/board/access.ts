import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import type { SystemRole } from "@/lib/permissions";

/** 도움말 메뉴에 들어올 수 있으면 질문을 쓴다. */
export async function canAskHelpBoard(role: SystemRole): Promise<boolean> {
  return canAccessTenant(role, "help");
}

/** 답변은 master · admin · super_admin. 화면에서만 잠그지 말고 서버 액션에서 다시 본다. */
export async function canAnswerHelpBoard(role: SystemRole): Promise<boolean> {
  if (await isCurrentUserSuperAdmin()) return true;
  return role === "master" || role === "admin";
}
