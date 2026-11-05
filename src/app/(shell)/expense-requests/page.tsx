import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getMyExpenseRequests } from "@/features/billing/server/expense-queries";
import { expenseWriteScope } from "@/features/billing/server/expense-scope";
import { ExpenseRequestsClient } from "./_client";

/**
 * 지출결의서(강사 제출) — 강사 미니셸 '내 메뉴' 진입. 강사는 본인이 작성한 결의서만 작성·조회하고
 * 결재 진행상태를 본다. 사무실(billing 쓰기 = master/admin/accountant 등)은 /billing 지출 면에서 전건을
 * 결재·처리하므로 여기 진입 시 그쪽으로 이동(교재 요청과 대칭이되 강사 전용 표면으로 정리).
 */
export default async function ExpenseRequestsPage() {
  const user = await requireAccess("expense_requests");
  // teacher(또는 겸직-강사뷰)가 아니면 사무실 지출 면으로. effectiveTeacherId!==null = '강사로 동작 중'.
  const teacherId = await effectiveTeacherId();
  if (teacherId === null) redirect("/billing?tab=expenses");

  // 이 화면의 주인(created_by)이 작성한 결의서 전건. 🔴 '다른 강사 뷰'(열람 전용)에선 보는 사람이 아니라
  // **대상 강사**의 결의서여야 한다(감사 E6 — 그 뷰의 존재 이유가 "그 사람이 보는 화면 그대로").
  // effectiveTeacherId = 본인 강사·겸직 강사뷰면 본인 id, 다른 강사 뷰면 대상 강사 id.
  // 쓰기 여부 = 서버 액션과 **같은 판정**(expenseWriteScope · 같은 행위자 getCurrentUser({teacherView})).
  // 읽기 권한이면 작성·수정·삭제·증빙 변경 단추를 그리지 않는다(원장 2026-11-05 — 다 쓰고 저장해야 거부가 떴다).
  const [rows, actor] = await Promise.all([getMyExpenseRequests(teacherId), getCurrentUser({ teacherView: true })]);
  const canWrite = actor ? (await expenseWriteScope(actor.systemRole)) !== null : false;

  // 작성자 표시 = 서버가 저장할 author 기본값과 같은 사람(createExpense의 행위자) — 강사뷰면 대상 강사 X.
  return <ExpenseRequestsClient rows={rows} requesterName={actor?.displayName ?? user.displayName} canWrite={canWrite} />;
}
