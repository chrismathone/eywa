import { UserPlus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "등록상담 — eywa" };

export default function EnrollmentPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="신입생 등록상담"
        description="문의 → 상담 → AI 분석 → 종이 인수인계서. 칸반 보드로 파이프라인을 관리합니다."
      />
      <EmptyState
        icon={UserPlus}
        title="진행 중인 상담이 없습니다"
        description="Phase 5에서 칸반 + Claude AI 분석 + A4 인쇄 양식이 구현됩니다."
      />
    </div>
  );
}
