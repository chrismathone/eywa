import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "대시보드 — eywa" };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="대시보드"
        description="재원생, 출석률, 수납 현황을 한눈에. 공지사항은 여기에 표시됩니다."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="아직 데이터가 없습니다"
        description="Phase 2에서 데이터 모델과 시드가 들어오면 이 자리에 KPI 카드, 공지, 오늘의 일정이 표시됩니다."
      />
    </div>
  );
}
