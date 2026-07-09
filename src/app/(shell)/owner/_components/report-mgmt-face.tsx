import { getClassnoteQueue, getReportFilterOptions, getWeeklyWritingRates } from "@/features/report-admin/server/queries";
import { listReports } from "@/features/report-admin/server/actions";
import { ClassnoteQueueCard } from "./classnote-queue-card";
import { WritingRateCard } from "./writing-rate-card";
import { ReportList } from "./report-list";

/**
 * 관리 · 보고서 관리 면 (owner ?tab=report_mgmt) — 원장이 학원 전체 보고서 발송을 총괄 관리.
 * Part A: ClassNote 발송 큐 현황·재발송. Part B: 강사별 주간 작성률. Part C: 보고서 목록/필터.
 */
export async function ReportMgmtFace() {
  const [queue, rates, filterOptions, firstPage] = await Promise.all([
    getClassnoteQueue(3),
    getWeeklyWritingRates(),
    getReportFilterOptions(),
    listReports({ page: 0 }),
  ]);
  const initialList = {
    rows: firstPage.rows ?? [],
    total: firstPage.total ?? 0,
    page: firstPage.page ?? 0,
    pageSize: firstPage.pageSize ?? 30,
  };
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
      {rates ? <WritingRateCard view={rates} /> : null}
      <ReportList options={filterOptions} initial={initialList} />
    </div>
  );
}
