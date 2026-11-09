import "server-only";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 경영 분석 시안의 문 — 대시보드를 열 수 있는 사람 중 원장(master)·관리자(admin)만.
 * 원래 화면의 `managementAccess()`(새 표·권한 키 필요)를 대신한다. 새 표를 읽지 않는다.
 */
export async function requireManagementSample() {
  const user = await requireAccess("dashboard");
  if (user.systemRole !== "master" && user.systemRole !== "admin" && !(await isCurrentUserSuperAdmin())) redirect("/dashboard");
  return user;
}
