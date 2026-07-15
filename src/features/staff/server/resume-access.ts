import "server-only";
import { cookies } from "next/headers";
import type { CurrentUser } from "@/lib/auth/current-user";
import { RESUME_VIEW_COOKIE, verifyResumeViewToken } from "./resume-view-token";

export const RESUME_LOCKED_MSG =
  "잠긴 이력서입니다 — 직원관리 › 이력서에서 재인증한 뒤 다시 시도하세요";

/**
 * 이력서 열람 자격 = **작성 본인 ∪ 원장 ∪ 유효한 재인증 토큰**(이력서별·10분, [resume-view-token.ts]).
 *
 * ⚠️ 뷰 페이지·쓰기 액션·데이터베이스 탐색기 삭제가 **전부 이 함수**를 거친다 — 화면에서만 잠그면
 * 서버액션 직접 호출이나 다른 표면(/documents의 같은 행)으로 우회된다(2026-07-15 적대검수 실적발).
 * 새 이력서 표면(열람·수정·삭제·내보내기)을 만들면 반드시 여기를 통과시킬 것.
 */
export async function canViewResume(
  user: CurrentUser,
  resumeId: string,
  uploadedBy: string | null,
): Promise<boolean> {
  if (uploadedBy && uploadedBy === user.id) return true; // 작성 본인 = 무재인증
  if (user.systemRole === "master") return true; // 원장 = 무재인증
  const jar = await cookies();
  return verifyResumeViewToken(jar.get(RESUME_VIEW_COOKIE)?.value, user.id, resumeId);
}
