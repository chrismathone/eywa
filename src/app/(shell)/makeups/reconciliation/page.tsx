import { EmbedLink as Link } from "@/components/embed-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { getMakeupReconciliation } from "@/features/makeups/server/queries";
import { ReconciliationItems } from "@/features/makeups/components/reconciliation-panel";
import { ReconciliationRun } from "@/features/makeups/components/reconciliation-run";

export const metadata = { title: "보강관리 · 대사·복구 — 에이와" };
const pageNumber = (value: string | undefined) => {
  const number = Number(value ?? 1);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 100_000) : 1;
};

export default async function MakeupReconciliationPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireAccess("makeups");
  const [params, canWrite] = await Promise.all([searchParams, canWriteTenant(actor.systemRole, "makeups")]);
  const page = pageNumber(params.page), jobPage = pageNumber(params.job_page);
  const result = await getMakeupReconciliation({ page, page_size: 30, projection_page: jobPage, projection_page_size: 30 });
  const data = result.data;
  const href = (next: number, nextJobs: number) => `/makeups/reconciliation?page=${next}&job_page=${nextJobs}`;
  return <div className="space-y-4 pb-6">
    <PageHeader title="대사·복구" description="남은 보강과 출결·시수·인계 차이를 확인합니다"
      actions={<Link href="/makeups" className="text-primary inline-block min-h-6 underline">목록</Link>} />
    {!data ? <div role="alert"><p>{result.error}</p><Link href={href(page, jobPage)} className="text-primary underline">다시 조회</Link></div> : <>
      <ReconciliationRun lastRun={data.last_run} canRun={canWrite && data.permissions.reconcile === true} />
      <p>미처리 대사 {data.total}건 · 기록 반영 대기 {data.projection_pending}건 · 반영 실패 {data.projection_failed}건</p>
      {!data.total && !data.projection_total ? <p>현재 범위에 미처리 대사·반영 작업이 없습니다.</p> : null}
      <ReconciliationItems items={data.rows} jobs={data.projection_jobs}
        canResolve={canWrite && data.permissions.resolve_reconciliation === true}
        canAcceptManual={canWrite && data.permissions.accept_manual_units === true} />
      <nav aria-label="미처리 대사 페이지" className="flex items-center justify-between gap-3">
        {data.page > 1 ? <Link href={href(data.page - 1, jobPage)} className="text-primary min-h-6 underline">이전 대사</Link> : <span />}
        <span>대사 {data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
        {data.page * data.page_size < data.total ? <Link href={href(data.page + 1, jobPage)} className="text-primary min-h-6 underline">다음 대사</Link> : <span />}
      </nav>
      <nav aria-label="기록 반영 작업 페이지" className="flex items-center justify-between gap-3">
        {data.projection_page > 1 ? <Link href={href(page, data.projection_page - 1)} className="text-primary min-h-6 underline">이전 반영 작업</Link> : <span />}
        <span>반영 작업 {data.projection_page} / {Math.max(1, Math.ceil(data.projection_total / data.projection_page_size))}</span>
        {data.projection_page * data.projection_page_size < data.projection_total ? <Link href={href(page, data.projection_page + 1)} className="text-primary min-h-6 underline">다음 반영 작업</Link> : <span />}
      </nav>
    </>}
  </div>;
}
