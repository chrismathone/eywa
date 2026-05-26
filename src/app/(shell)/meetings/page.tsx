import { NotebookPen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "회의록 — eywa" };

export default function MeetingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="회의록"
        description="회의 기록과 AI 요약·액션 아이템 추적."
      />
      <EmptyState
        icon={NotebookPen}
        title="기록된 회의가 없습니다"
        description="Phase 6에서 회의록 입력과 AI 요약이 구현됩니다."
      />
    </div>
  );
}
