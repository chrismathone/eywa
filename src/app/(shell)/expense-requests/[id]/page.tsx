import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getExpenseById } from "@/features/billing/server/expense-queries";
import { ExpenseDocument } from "@/app/(shell)/billing/_components/expense-document";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const expense = await getExpenseById(id);
  return { title: expense ? `${expense.title} · 지출결의서 — eywa` : "지출결의서 — eywa" };
}

/**
 * 강사 본인 지출결의서 상세(읽기전용 + 인쇄) — /billing/expenses/[id]는 billing 게이트라 강사가 못 봄.
 * 이 라우트는 expense_requests 게이트 + 본인 작성분(created_by=본인)만 열람(타인 결의서 열람 차단).
 * 사무실은 /billing 지출 목록에서 전건 상세를 본다.
 */
export default async function ExpenseRequestDetailPage({ params }: Params) {
  const user = await requireAccess("expense_requests");
  const { id } = await params;
  const expense = await getExpenseById(id);
  // 본인 것이 아니면 존재를 숨긴다(테넌트 RLS는 통과하므로 앱 레이어에서 own 스코프 강제).
  if (!expense || expense.createdBy !== user.id) notFound();
  return <ExpenseDocument expense={expense} />;
}
