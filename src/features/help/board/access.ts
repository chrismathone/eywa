import "server-only";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import type { SystemRole } from "@/lib/permissions";

/**
 * 도움말 메뉴에 **쓰기** 권한이 있으면 질문을 쓴다(작성 · 수정 · 삭제 · 닫기 공통).
 * 🔴 `canAccessTenant`로 되돌리지 말 것 — 읽기 권한(readonly)과 '다른 강사 뷰'(열람 전용)까지 통과해 '질문하기'가 서고
 *    저장도 됐다(2026-11-05 권한 감사, 원장 *"읽기 권한인데 쓸 수 있는것처럼 오해"*). 화면(page.tsx)도 같은 함수를 본다.
 */
export async function canAskHelpBoard(role: SystemRole): Promise<boolean> {
  return canWriteTenant(role, "help");
}

/**
 * 답변은 master · admin · super_admin. master·admin은 **도움말 쓰기 권한이 있을 때만**(역할만 보면 도움말이 '읽기'인
 * 원장·관리자도 답변이 저장됐다, 2026-11-05). 화면에서만 잠그지 말고 서버 액션에서 다시 본다.
 * 🔴 super_admin은 먼저 통과한다 — "총괄은 새로 만드는 어떤 제한 명단·게이트도 자동 통과"(CLAUDE.md 직원·권한). 지점이 그 계정의
 *    역할 줄에서 도움말을 '읽기'로 낮춰도 답변은 막히지 않는다(이번 변경 전과 같음 · 2026-11-05 리뷰).
 */
export async function canAnswerHelpBoard(role: SystemRole): Promise<boolean> {
  if (await isCurrentUserSuperAdmin()) return true;
  if (!(await canWriteTenant(role, "help"))) return false;
  return role === "master" || role === "admin";
}
