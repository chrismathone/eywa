import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { emptyRefund } from "@/features/billing/refund-request";
import { RefundSheet } from "../_components/refund-sheet";

export const metadata = { title: "환불 요청서 작성 — eywa" };

export default async function NewRefundPage() {
  const user = await requireAccess("billing");
  if (!(await canWriteTenant(user.systemRole, "billing"))) redirect("/billing?tab=refunds");

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/billing?tab=refunds" label="환불 요청서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">환불 요청서 작성</h1>
        <p className="text-text-dim mt-1 text-sm">
          종이 서식의 각 칸에 바로 입력하세요 — 저장하면 데이터베이스(수납·결제)에 보관되고 언제든 다시 수정·A4 인쇄할 수 있습니다.
        </p>
      </header>
      <RefundSheet data={emptyRefund()} canWrite startEditing />
    </div>
  );
}
