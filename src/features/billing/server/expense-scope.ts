import "server-only";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";

/**
 * 지출결의서 쓰기 스코프 — 사무실(billing 쓰기)="full"(전건 관리·결재), 강사(expense_requests 쓰기)="own"(본인 것만).
 * ⚠️ 결재 승인 토글(toggleExpenseApproval)은 이 스코프가 아니라 billing 쓰기만 통과 → 강사가 자기 결의서를 셀프 승인 못 함.
 *
 * 🔴 서버 액션(expense-actions.ts)과 화면(/expense-requests page.tsx의 작성·수정 단추 노출)이 **이 한 함수**를 쓴다
 *    (원장 2026-11-05 — 화면이 다른 판정을 보면 "보이는데 저장이 안 됨"이 다시 생긴다, write-lock.ts).
 * ⚠️ "use server" 파일에 두지 않는다 — 거기서 export하면 클라가 부를 수 있는 엔드포인트가 된다.
 */
export type ExpenseWriteScope = "full" | "own";

export async function expenseWriteScope(role: SystemRole): Promise<ExpenseWriteScope | null> {
  if (await canWriteTenant(role, "billing")) return "full";
  if (await canWriteTenant(role, "expense_requests")) return "own";
  return null;
}
