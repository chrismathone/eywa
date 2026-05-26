import { Calendar } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "시간표 — eywa" };

export default function TimetablePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="시간표"
        description="과목별·강사별 시간표. 반 이동 시뮬레이션과 엑셀 가져오기가 들어올 자리입니다."
      />
      <EmptyState
        icon={Calendar}
        title="시간표 데이터 없음"
        description="Phase 3에서 시간표 그리드와 드래그앤드롭 편집이 구현됩니다."
      />
    </div>
  );
}
