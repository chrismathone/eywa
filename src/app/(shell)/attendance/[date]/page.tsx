import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "출석부 — eywa" };

export default async function AttendanceByDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  return (
    <div className="space-y-6">
      <PageHeader
        title="출석부"
        description={`${date} · 반×교시 그리드로 한눈에 출결을 확인하고 입력합니다.`}
      />
      <EmptyState
        icon={ClipboardCheck}
        title="이 날짜의 수업이 없습니다"
        description="Phase 3에서 반×교시 그리드와 인라인 출결 입력이 구현됩니다."
      />
    </div>
  );
}
