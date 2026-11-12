import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { resolveDutyAdminScope } from "./admin";
import type { DutyAdminScope } from "../view-admin";

/**
 * 업무 완성도 관리자 화면의 문 — 페이지(`requireAccess("duties")`)와 GET 라우트가 **같은 권한 키**를 본다("N건 있다"는 신호와 그 일을 하는 화면은 같은 게이트).
 * 과목 범위는 운영실과 같은 판정(`resolveDutyAdminScope`). 학생 계정은 열지 않는다.
 */
export async function getDutyAdminViewer(): Promise<{ user: CurrentUser; scope: DutyAdminScope } | null> {
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return null;
  if (!(await canAccessTenant(user.systemRole, "duties"))) return null;
  return { user, scope: await resolveDutyAdminScope(user) };
}
