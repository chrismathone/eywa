import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getRefundRequestById } from "@/features/billing/server/refund-queries";
import { RefundSheet } from "../_components/refund-sheet";

export const metadata = { title: "환불 요청서 — 에이와" };

export default async function RefundViewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("billing");
  const { id } = await params;
  const [refund, canWrite] = await Promise.all([
    getRefundRequestById(id),
    canWriteTenant(user.systemRole, "billing"),
  ]);
  if (!refund) notFound();
  const name = refund.data.student.name || "(이름 미입력)";

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/billing?tab=refunds" label="환불 요청서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">환불 요청서 — {name}</h1>
        <p className="text-text-dim text-xs">
          {new Date(refund.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 작성
          {refund.authorName ? ` · ${refund.authorName}` : ""} · 데이터베이스(수납·결제)에 저장됨
        </p>
      </header>
      <RefundSheet data={refund.data} id={id} userId={user.id} canWrite={canWrite} />
    </div>
  );
}
