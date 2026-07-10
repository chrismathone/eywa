import { requireAccess } from "@/lib/auth/require-access";
import { getClassnoteQueue, getReportFilterOptions, getWeeklyWritingRates } from "@/features/report-admin/server/queries";
import { getEdutrixUnmapped } from "@/features/report-admin/server/edutrix-map-queries";
import { listReports } from "@/features/report-admin/server/actions";
import { ClassnoteQueueCard } from "./_components/classnote-queue-card";
import { WritingRateCard } from "./_components/writing-rate-card";
import { ReportList } from "./_components/report-list";
import { EdutrixUnmappedCard } from "./_components/edutrix-unmapped-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "수업보고서 — eywa" };

/**
 * 수업보고서(발송 관리) — 좌측 독립 메뉴(구 학원설정 ?tab=report_mgmt에서 승격). 옛 Edutrix 외부링크 대체.
 * 원장·관리자·실장(lesson_reports 권한)이 학원 전체 수업보고서 발송을 총괄 관리한다.
 * Part A: ClassNote 발송 큐. Part B: 작성률. Part C: Edutrix 미매핑. Part D: 목록/필터.
 * 강사 작성 화면은 /onescreen — 여기는 총괄 관리(오버사이트)만.
 */
export default async function LessonReportsPage() {
  await requireAccess("lesson_reports");
  const [queue, rates, filterOptions, firstPage, edutrixMap] = await Promise.all([
    getClassnoteQueue(3),
    getWeeklyWritingRates(),
    getReportFilterOptions(),
    listReports({ page: 0 }),
    getEdutrixUnmapped(),
  ]);
  const initialList = {
    rows: firstPage.rows ?? [],
    total: firstPage.total ?? 0,
    page: firstPage.page ?? 0,
    pageSize: firstPage.pageSize ?? 30,
  };
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="border-border border-b pb-5">
        <p className="eyebrow">수업보고서</p>
        <h1 className="display text-foreground text-2xl">보고서 발송 관리</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          학원 전체 수업보고서 발송 현황을 확인하고, 실패·멈춘 발송을 재처리합니다. Edutrix 미매핑 학생은 아래에서
          UUID로 연결합니다. 보고서 작성은 선생님 원스크린에서 진행합니다.
        </p>
      </header>

      {queue ? (
        <ClassnoteQueueCard view={queue} />
      ) : (
        <p className="text-text-faint text-sm">발송 현황을 불러올 수 없습니다.</p>
      )}
      {rates ? <WritingRateCard view={rates} /> : null}
      <EdutrixUnmappedCard view={edutrixMap} />
      <ReportList options={filterOptions} initial={initialList} />
    </div>
  );
}
