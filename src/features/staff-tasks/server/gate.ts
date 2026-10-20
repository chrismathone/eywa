import "server-only";
import { cache } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canMonitorStaffTasks } from "../access";

export type StaffTaskViewer = { user: CurrentUser; canMonitor: boolean };

/**
 * 할 일을 읽는 사람 — 벨 · 강사 홈 · 운영실 카드 · 목록/상세 라우트가 이 한 함수를 지난다([[#77]]).
 * 맡은 사람은 자기 할 일, 원장 역할과 지정한 사람(`canMonitorStaffTasks`)은 모든 직원의 할 일.
 * 운영 콘솔의 '지점 보기' 중에는 비운다(벨과 같은 규칙 — 할 일은 사람에게 묶인 기록이라 보는 지점의 것이 아니다).
 */
export const getStaffTaskViewer = cache(async (): Promise<StaffTaskViewer | null> => {
  // 로그인한 본인(‘다른 강사 뷰’로 보는 사람이 아니다) — 할 일은 본인에게 묶인 기록이다.
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student" || user.tenantView) return null;
  if (await isTenantViewWriteBlocked()) return null;
  const [isSuperAdmin, settings] = await Promise.all([isCurrentUserSuperAdmin(), getTenantSettings()]);
  return {
    user,
    canMonitor: canMonitorStaffTasks(user, { isSuperAdmin, monitorIds: settings.permissions.specialAccess.staffTaskMonitorIds }),
  };
});
