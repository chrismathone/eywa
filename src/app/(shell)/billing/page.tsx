import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "수납관리 — eywa" };

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="수납관리"
        description="청구서 발행, 학생별 미수금, 월별 수납 리포트."
      />
      <EmptyState
        icon={Wallet}
        title="청구 내역이 없습니다"
        description="Phase 6에서 청구서 CRUD와 수강료 계산이 구현됩니다."
      />
    </div>
  );
}
