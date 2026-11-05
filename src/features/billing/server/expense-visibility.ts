import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { expenseWriteScope } from "./expense-scope";

/**
 * 관리 클라이언트로 읽은 지출결의서가 행위자(X)에게 보이는 행인가 — RLS `expenses_role_gate_select`(0158a)를 X 기준으로:
 *   지출 열람(`billing` ≠ none) **or** (지출결의서 **제출 권한** `expense_requests` ∈ full·scoped **and** 본인 작성분).
 * '다른 강사 뷰'(원장 A → 직원 X)는 DB의 `auth.uid()`가 A라 RLS가 X 기준으로 거르지 못한다 — 관리 클라이언트로 읽고
 * 이 판정을 앱에서 다시 건다. 세션 클라이언트일 때는 RLS가 이미 걸렀으므로 부르지 않는다.
 * 🔴 목록(`getMyExpenseRequests`) · 상세(`getExpenseById`) · 증빙 서명(expense-actions.ts)이 **이 한 함수**를 쓴다
 *    (적대 재리뷰 2026-11-05 — 서명만 이 판정이면 목록·상세에 뜬 결의서의 증빙이 "찾을 수 없습니다"가 됐다).
 * ⚠️ 열람 전용 강사뷰는 권한표가 X의 full·scoped를 읽기로 눌러 둔다 — 그 캡은 '쓰기'를 막으려는 것이라, 여기서는 X의 원래 수준
 *    대신 '메뉴 접근'으로 본다(X가 원래 제출 권한이었는지 구분할 수 없어 읽기 강사뷰에서만 한 단계 넓다).
 * ⚠️ "use server" 파일에 두지 않는다 — 거기서 export하면 클라가 부를 수 있는 엔드포인트가 된다.
 */
export async function expenseVisibleToActor(row: { created_by?: string | null }, user: CurrentUser): Promise<boolean> {
  if (await canAccessTenant(user.systemRole, "billing")) return true;
  if (row.created_by !== user.id) return false;
  if ((await expenseWriteScope(user.systemRole)) !== null) return true;
  return (await viewAsTeacher())?.access === "readonly" && (await canAccessTenant(user.systemRole, "expense_requests"));
}
