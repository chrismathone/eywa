import "server-only";
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView, viewAsTeacher } from "@/lib/auth/view-as";
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
 * 강사 홈 '받은 업무 요청'도 이 값을 읽는다(메뉴 권한이 아니라 사람으로 거른다 — 맡은 업무는 대시보드 권한과 무관하게 받아야 한다).
 * '다른 강사 뷰'면(읽기든 전체든) 그 강사의 업무를 읽기 전용으로(`readonly` — 만들기 · 처리 칸 없음 · 서버 액션도 막는다 — 대신 보고하지 않는다).
 */
export async function loadWorkBoard(): Promise<WorkBoard> {
  const viewer = await getStaffTaskViewer();
  if (!viewer) return NO_WORK;
  const tenantId = viewer.user.tenantId;
  // 업무 행과 직원 이름은 서로 독립 — 함께 기다린다(B4).
  const [rows, people, readonly] = await Promise.all([
    fetchWork(tenantId, viewer.user.id, viewer.canMonitor, kstToday()),
    Promise.all([getSuperAdminIds(), getTenantSettings()]).then(([superAdmins, settings]) => staffOf(tenantId, superAdmins, buildSubjectMaps(settings.operations.subjects).labelOf)),
    Promise.all([viewAsTeacher(), isReadonlyTeacherView()]).then(([as, ro]) => (ro && !as ? "unverified" as const : !!as || ro)),
  ]);
  // 강사뷰 대상을 확인하지 못한 요청이면 비운다 — 확인 못 하면 사람이 보는 사람 본인으로 돌아가 그 강사 화면에 본인 요청이 선다(주기 갱신마다 판정 · 리뷰 2026-11-11).
  if (!rows || readonly === "unverified") return NO_WORK;
  const canCreate = !readonly && canCreateWork(viewer);
  return { enabled: true, me: viewer.user.id, canCreate, canMonitor: viewer.canMonitor, readonly: readonly === true, items: buildWork(rows, viewer.user.id, viewer.canMonitor, people.all), staff: canCreate ? people.active : [] };
}
