import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { canSeeStaffMember, getViewerStaffScope } from "./subject-scope";

export const RESUME_LOCKED_MSG = "이력서는 직원관리 권한이 있는 계정과 본인만 열람·수정할 수 있습니다";

/**
 * 이력서 열람 자격 = **직원관리(staff) 메뉴 접근자**(개인 예외 포함), 그리고 **본인 이력서에 한해 그 직원 본인**.
 * (2026-07-28 재인증(step-up) 제거 → 원장·관리자 전용 / 2026-07-29 원장 지시로 '본인 것만' 추가 /
 *  2026-08-01 직원관리를 원장+개발팀 4인으로 좁히며 역할 하드코딩(master·admin) → 메뉴 게이트로 전환:
 *  메뉴가 잠긴 관리자가 데이터베이스 탐색기 등 다른 표면으로 남의 이력서를 여는 우회를 함께 닫는다.)
 *
 * ⚠️ 뷰 페이지·쓰기 액션·데이터베이스 탐색기 삭제·직원 상세 이력서 섹션이 **전부 이 함수**를 거친다 —
 * 화면에서만 잠그면 서버액션 직접 호출이나 다른 표면으로 우회된다([[#77]], 2026-07-15 적대검수 실적발).
 * 새 이력서 표면(열람·수정·삭제·내보내기)을 만들면 반드시 여기를 통과시킬 것.
 *
 * @param ownerStaffUserId 그 이력서에 연결된 직원(users.id, `academy_documents.staff_user_id`).
 *   **모르면 넘기지 말 것** — 생략하면 직원관리 접근자만 통과하는 기존(안전한) 기준으로 판정한다.
 */
export async function canViewResume(
  user: CurrentUser,
  ownerStaffUserId?: string | null,
): Promise<boolean> {
  if (!!ownerStaffUserId && ownerStaffUserId === user.id) return true;
  if (!(await canAccessTenant(user.systemRole, "staff"))) return false;
  // 과목 범위(원장 2026-09-23)가 걸린 사람은 **범위 안 직원의 이력서만** — 누구 것인지 모르는 판정(owner 생략)은 거절.
  if (!(await getViewerStaffScope(user))) return true;
  if (!ownerStaffUserId) return false;
  return canSeeStaffMember(user, ownerStaffUserId);
}
