import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { getPortfolioGate } from "./queries";

/**
 * 강사평가를 **바꾸는** 모든 액션의 문 — 원장 게이트(직원 포트폴리오와 같은 문) + 읽기 전용 보기 거절 + 직원 평가 쓰기 권한.
 * 설정 저장 · 직접 입력 · 구성 저장/삭제가 같은 함수를 지난다(화면의 잠금도 같은 판정 — evaluation-face.tsx).
 */
export const EVALUATION_DENIED = "강사평가 설정을 바꿀 권한이 없습니다";

export async function evaluationWriteGate(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const gate = await getPortfolioGate();
  const user = await getCurrentUser({ teacherView: true });
  if (!gate || !user) return { error: EVALUATION_DENIED };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { error: readonly };
  if (!(await canWriteTenant(user.systemRole, "class_review"))) return { error: EVALUATION_DENIED };
  return gate;
}
