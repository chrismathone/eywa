import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";

export const RESUME_LOCKED_MSG = "이력서는 원장·관리자와 본인만 열람·수정할 수 있습니다";

/**
 * 이력서 열람 자격 = **원장(master)·관리자(admin)**, 그리고 **본인 이력서에 한해 그 직원 본인**.
 * (2026-07-28 재인증(step-up) 제거 → 원장·관리자 전용 / 2026-07-29 원장 지시로 '본인 것만' 추가:
 *  직원이 직접 자기 이력서를 채워 넣어야 하는 상황. 남의 이력서는 여전히 불가.)
 *
 * ⚠️ 뷰 페이지·쓰기 액션·데이터베이스 탐색기 삭제·직원 상세 이력서 섹션이 **전부 이 함수**를 거친다 —
 * 화면에서만 잠그면 서버액션 직접 호출이나 다른 표면으로 우회된다([[#77]], 2026-07-15 적대검수 실적발).
 * 새 이력서 표면(열람·수정·삭제·내보내기)을 만들면 반드시 여기를 통과시킬 것.
 *
 * @param ownerStaffUserId 그 이력서에 연결된 직원(users.id, `academy_documents.staff_user_id`).
 *   **모르면 넘기지 말 것** — 생략하면 원장·관리자만 통과하는 기존(안전한) 기준으로 판정한다.
 */
export async function canViewResume(
  user: CurrentUser,
  ownerStaffUserId?: string | null,
): Promise<boolean> {
  if (user.systemRole === "master" || user.systemRole === "admin") return true;
  return !!ownerStaffUserId && ownerStaffUserId === user.id;
}
