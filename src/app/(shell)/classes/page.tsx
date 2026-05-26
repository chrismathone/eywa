import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "수업목록 — eywa" };

export default function ClassesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="수업목록"
        description="과목·강사·시간대별 반 목록. 클릭하면 학생 명단/진도/배정을 봅니다."
      />
      <EmptyState
        icon={BookOpen}
        title="등록된 수업이 없습니다"
        description="Phase 3에서 반 생성·편집 흐름이 구현됩니다."
      />
    </div>
  );
}
