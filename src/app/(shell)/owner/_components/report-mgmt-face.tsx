import { getClassnoteQueue } from "@/features/report-admin/server/queries";
import { ClassnoteQueueCard } from "./classnote-queue-card";

/**
 * 관리 · 보고서 관리 면 (owner ?tab=report_mgmt) — 원장이 학원 전체 보고서 발송을 총괄 관리.
 * Part A: ClassNote 발송 큐 현황·재발송. Part B(강사별 작성률)·C(보고서 목록)는 후속 커밋에서 추가.
 */
export async function ReportMgmtFace() {
  const queue = await getClassnoteQueue(3);
  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 보고서</p>
        <h2 className="text-foreground text-lg font-semibold">보고서 발송 관리</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          학원 전체 수업보고서 발송 현황을 확인하고, 실패·멈춘 발송을 재처리합니다.
        </p>
      </header>
      {queue ? (
        <ClassnoteQueueCard view={queue} />
      ) : (
        <p className="text-text-faint text-sm">발송 현황을 불러올 수 없습니다.</p>
      )}
    </div>
  );
}
