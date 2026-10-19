import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canManageTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";

/**
 * 메모 시트(시간표 오른쪽 엑셀 판) 문 — 화면(판을 그릴지·편집 도구를 줄지)과 저장 액션이 **같은 함수**를 지난다(#77).
 * · 보기 = 시간표를 열 수 있는 직원. 🔴 **강사 화면(본인·'다른 강사 뷰')엔 없다** — 판은 학원 전체 메모라
 *   강사 범위로 좁힌 시간표에 붙이면 남의 반·학생 이야기가 샌다(시간표 X 겹침과 같은 판단).
 * · 편집 = 시간표 '전체'(관리자 계열). `canWriteTenant`는 담당 범위(scoped) 강사도 통과하므로 쓰지 않는다.
 */
export async function memoSheetAccess(user: CurrentUser): Promise<{ canView: boolean; canEdit: boolean }> {
  if ((await effectiveTeacherId()) != null) return { canView: false, canEdit: false };
  const canView = await canAccessTenant(user.systemRole, "timetable");
  if (!canView) return { canView: false, canEdit: false };
  return { canView, canEdit: await canManageTenant(user.systemRole, "timetable") };
}
