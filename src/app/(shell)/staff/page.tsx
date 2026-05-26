import { BadgeCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "직원관리 — eywa" };

export default function StaffPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="직원관리"
        description="강사·상담·회계 등 직원 정보. 상세 안에 급여 탭이 포함됩니다."
      />
      <EmptyState
        icon={BadgeCheck}
        title="등록된 직원이 없습니다"
        description="Phase 6에서 직원 CRUD + 출석 기반 급여 정산이 구현됩니다."
      />
    </div>
  );
}
