import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getExpenseById } from "@/features/billing/server/expense-queries";
import { ExpenseDocument } from "@/app/(shell)/billing/_components/expense-document";

type Params = { params: Promise<{ id: string }> };

// 🔴 고정 제목(감사 S9) — 탭 제목은 본문의 소유 판정보다 먼저 만들어져, 남의 결의서 주소를 열면 본문은 404인데
//    탭에 그 결의서 제목이 새어 나갔다. 제목엔 레코드 내용을 싣지 않는다.
export const metadata = { title: "지출결의서 — 에이와" };

/**
 * 강사 본인 지출결의서 상세(읽기전용 + 인쇄) — /billing/expenses/[id]는 billing 게이트라 강사가 못 봄.
 * 이 라우트는 expense_requests 게이트 + 본인 작성분(created_by=본인)만 열람(타인 결의서 열람 차단).
 * 사무실은 /billing 지출 목록에서 전건 상세를 본다.
 */
export default async function ExpenseRequestDetailPage({ params }: Params) {
  const user = await requireAccess("expense_requests");
  const { id } = await params;
  // 목록과 같은 주인 판정 — '다른 강사 뷰'면 대상 강사, 그 밖엔 로그인한 본인(E6).
  const [expense, ownerId] = await Promise.all([getExpenseById(id), effectiveTeacherId()]);
  // 본인 것이 아니면 존재를 숨긴다(테넌트 RLS는 통과하므로 앱 레이어에서 own 스코프 강제).
  if (!expense || expense.createdBy !== (ownerId ?? user.id)) notFound();
  return <ExpenseDocument expense={expense} />;
}
