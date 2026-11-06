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
 * '다른 강사 뷰'면 **그 강사**다(원장 2026-11-05 *"실제 그 사람으로 완벽하게 전환"* — 계기: 김태건 선생님의 '퇴원보고서 작성'
 * 할 일이 강사뷰의 '내 할 일'에 안 뜨고 보는 관리자 본인 할 일이 떴다). 현황 권한도 그 강사 기준(운영 계정 우회는
 * 강사뷰 중 꺼진다 — super-admin.ts). 쓰는 쪽(업무 요청 등)은 '읽기' 강사뷰를 따로 막는다(work-requests/server/actions.ts).
 */
export const getStaffTaskViewer = cache(async (): Promise<StaffTaskViewer | null> => {
  // 할 일은 사람에게 묶인 기록이다 — 평소엔 로그인한 본인, '다른 강사 뷰'면 검증된 대상 강사.
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.systemRole === "student" || user.tenantView) return null;
  if (await isTenantViewWriteBlocked()) return null;
  const [isSuperAdmin, settings] = await Promise.all([isCurrentUserSuperAdmin(), getTenantSettings()]);
  return {
    user,
    canMonitor: canMonitorStaffTasks(user, { isSuperAdmin, monitorIds: settings.permissions.specialAccess.staffTaskMonitorIds }),
  };
});
