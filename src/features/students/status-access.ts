import type { SystemRole } from "@/lib/permissions";

export const STUDENT_STATUS_DENIED = "원생 상태 변경 권한이 없습니다. 학원 설정의 개인별 기능 권한을 확인해 주세요.";
const OFFICE = new Set<SystemRole>(["master", "admin", "manager", "counselor", "accountant"]);

/** Feature assignment never widens menu access or the existing office write boundary. */
export function canManageStudentStatus(
  actor: { id: string; systemRole: SystemRole }, privileged: boolean, ids: readonly string[] | undefined,
): boolean {
  if (privileged) return true;
  if (!OFFICE.has(actor.systemRole)) return false;
  return actor.systemRole === "master" || ids === undefined || ids.includes(actor.id);
}

export function statusCreationNeedsPermission(status: string, withdrawnAt: string | null): boolean {
  return status === "on_hold" || status === "withdrawn" || !!withdrawnAt;
}
