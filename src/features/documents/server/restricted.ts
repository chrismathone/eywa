import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";

/**
 * 자료실 **제한(restricted) 문서** — 환불처리요청서(계좌·환불금액) · 수업 평가 점수처럼 사무실 역할만 여는 문서.
 * 역할 목록은 DB 백스톱 `academy_documents_restricted_guard`(0170a)의 **직원 연결이 없는 행**(staff_user_id IS NULL) 분기와 같다.
 *
 * 🔴 DB는 `auth.uid()`(실제 로그인 계정)의 역할로 거른다 — DB는 '다른 강사 뷰'를 모른다. 그래서 원장이 강사 X 화면을 열면
 *    X가 못 보는 제한 문서가 목록 · 상세 · 내려받기에 그대로 나왔다. 앱이 **이 요청의 행위자(강사뷰면 대상 X)** 역할로
 *    한 번 더 거른다. DB보다 넓히지는 않는다(DB가 이미 거른 행은 오지 않는다).
 * ⚠️ 직원 연결 문서(이력서·계약서, staff_user_id 有)는 이 탐색기에서 통째로 빠진다(`.is("staff_user_id", null)`) — 여기 대상 아님.
 */
export const RESTRICTED_DOCUMENT_ROLES: readonly SystemRole[] = ["master", "admin", "manager", "accountant"];

export function canSeeRestrictedDocuments(role: SystemRole): boolean {
  return RESTRICTED_DOCUMENT_ROLES.includes(role);
}

/** 이 요청의 행위자(강사뷰면 대상)가 제한 문서를 못 보면 true — 자료실 조회·서명·변경이 `restricted = false`로 좁힌다. */
export async function hideRestrictedDocuments(): Promise<boolean> {
  const actor = await getCurrentUser({ teacherView: true });
  return !actor || !canSeeRestrictedDocuments(actor.systemRole);
}
