import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";

export const RESUME_LOCKED_MSG = "이력서는 원장·관리자만 열람·수정할 수 있습니다";

/**
 * 이력서 열람 자격 = **원장(master)·관리자(admin)** — 2026-07-28 원장 지시로 재인증(step-up) 제거
 * ("열람 비밀번호 이런거 빼, 원장 관리자만 바로 볼 수 있게"). 그 외 역할은 열람·수정·삭제 불가.
 *
 * ⚠️ 뷰 페이지·쓰기 액션·데이터베이스 탐색기 삭제·직원 상세 이력서 섹션이 **전부 이 함수**를 거친다 —
 * 화면에서만 잠그면 서버액션 직접 호출이나 다른 표면으로 우회된다([[#77]], 2026-07-15 적대검수 실적발).
 * 새 이력서 표면(열람·수정·삭제·내보내기)을 만들면 반드시 여기를 통과시킬 것.
 */
export async function canViewResume(user: CurrentUser): Promise<boolean> {
  return user.systemRole === "master" || user.systemRole === "admin";
}
