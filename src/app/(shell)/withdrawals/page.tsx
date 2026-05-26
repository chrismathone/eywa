import { UserMinus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "퇴원관리 — eywa" };

export default function WithdrawalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="퇴원관리"
        description="퇴원 사유·통계와 처리 워크플로우. 다시 등록하는 학생도 추적합니다."
      />
      <EmptyState
        icon={UserMinus}
        title="처리된 퇴원이 없습니다"
        description="Phase 4에서 퇴원 처리 흐름과 사유 통계가 구현됩니다."
      />
    </div>
  );
}
