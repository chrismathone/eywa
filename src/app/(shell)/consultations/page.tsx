import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "학생상담 — eywa" };

export default function ConsultationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="학생상담"
        description="재원생 상담 기록과 진행 상태. 강사·상담담당 모두 사용합니다."
      />
      <EmptyState
        icon={MessagesSquare}
        title="기록된 상담이 없습니다"
        description="Phase 4에서 상담 입력 폼과 타임라인이 구현됩니다."
      />
    </div>
  );
}
