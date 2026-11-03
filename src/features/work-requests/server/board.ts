import "server-only";
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { kstToday } from "@/lib/date-kst";
import { getStaffTaskViewer, type StaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { NO_WORK, type WorkBoard } from "../model";
import { buildWork, fetchWork, staffOf } from "./queries";

/** 업무를 요청할 수 있나 — 지금은 관리자끼리 먼저(원장 · 관리자 · 매니저 + 업무 처리 현황 권한자). */
export function canCreateWork(viewer: StaffTaskViewer): boolean {
  return viewer.canMonitor || ["master", "admin", "manager"].includes(viewer.user.systemRole);
}

/**
 * 대시보드 '업무 흐름' 구역의 값. 사람은 할 일과 같은 문(`getStaffTaskViewer` — 로그인한 본인 · 지점 보기 중에는 없음)을 지난다.
 * 표가 아직 없으면(SQL 적용 전) 구역째 없다.
 */
export async function loadWorkBoard(): Promise<WorkBoard> {
  const viewer = await getStaffTaskViewer();
  if (!viewer) return NO_WORK;
  const tenantId = viewer.user.tenantId;
  // 업무 행과 직원 이름은 서로 독립 — 함께 기다린다(B4).
  const [rows, people] = await Promise.all([
    fetchWork(tenantId, viewer.user.id, viewer.canMonitor, kstToday()),
    Promise.all([getSuperAdminIds(), getTenantSettings()]).then(([superAdmins, settings]) => staffOf(tenantId, superAdmins, buildSubjectMaps(settings.operations.subjects).labelOf)),
  ]);
  if (!rows) return NO_WORK;
  const canCreate = canCreateWork(viewer);
  return { enabled: true, me: viewer.user.id, canCreate, canMonitor: viewer.canMonitor, items: buildWork(rows, viewer.user.id, viewer.canMonitor, people.all), staff: canCreate ? people.active : [] };
}
