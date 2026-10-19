import type { SystemRole } from "@/lib/permissions";

/**
 * 업무 처리 현황(모든 직원의 할 일)을 볼 수 있나 — 원장 역할 + 학원 설정 '역할·권한'의 개인별 기능 권한에서 지정한 사람
 * (`permissions.specialAccess.staffTaskMonitorIds`). 맡은 사람은 지정과 상관없이 **자기 할 일**만 본다.
 * 🔴 코드에 계정 명단을 두지 않는다(staff.md '사람을 지정하는 권한은 전부 역할·권한 면에서').
 */
export function canMonitorStaffTasks(
  user: { id: string; systemRole: SystemRole },
  policy: { isSuperAdmin: boolean; monitorIds: readonly string[] | undefined },
): boolean {
  if (policy.isSuperAdmin || user.systemRole === "master") return true;
  return Array.isArray(policy.monitorIds) && policy.monitorIds.includes(user.id);
}
