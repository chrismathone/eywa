import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "학생목록 — eywa" };

export default function StudentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="학생목록"
        description="재원/예비/퇴원 상태별 학생. 상세에서 출결·성적·숙제·시험·교재·상담·결제를 한 화면에."
      />
      <EmptyState
        icon={Users}
        title="등록된 학생이 없습니다"
        description="Phase 4에서 검색·필터·일괄 작업이 구현됩니다."
      />
    </div>
  );
}
