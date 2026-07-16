import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getMyExpenseRequests } from "@/features/billing/server/expense-queries";
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

  // 본인(created_by=본인)이 작성한 결의서 전건 — 스코프 소스는 실제 작성자 user id(view-mode와 무관).
  const rows = await getMyExpenseRequests(user.id);

  return <ExpenseRequestsClient rows={rows} requesterName={user.displayName} />;
}
