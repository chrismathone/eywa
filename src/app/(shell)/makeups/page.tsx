import { EmbedLink as Link } from "@/components/embed-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getMakeupCases } from "@/features/makeups/server/queries";
import { MakeupListToolbar } from "@/features/makeups/components/list-toolbar";
import { MakeupCaseTable } from "@/features/makeups/components/case-list";

export const metadata = { title: "보강관리 — 에이와" };
export default async function MakeupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAccess("makeups");
  const [params, settings, canWrite] = await Promise.all([searchParams, getTenantSettings(), canWriteTenant(actor.systemRole, "makeups")]);
  const filter: Record<string, string> = {};
  for (const key of ["tab", "flag", "subject_key", "owner_id", "student_id", "q", "page"]) {
    const value = params[key]; if (typeof value === "string" && value.length <= 100) filter[key] = value;
  }
  const rawPage = Number(filter.page || 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
  const result = await getMakeupCases({ ...filter, page, page_size: 30 });
  return <div className="space-y-4 pb-6">
    <PageHeader title="보강관리" description="접수·예약·실시 검토와 미처리 업무" actions={<div className="flex items-center gap-3" data-help="makeups-intake">
      <Link href="/makeups/candidates" className="text-primary inline-block min-h-6 underline">미연결 근거</Link>
      <Link href="/makeups/dry-run" className="text-primary inline-block min-h-6 underline">도입 사전 점검</Link>
      <Link href="/makeups/reconciliation" className="text-primary inline-block min-h-6 underline">대사·복구</Link>
      {canWrite && settings.makeups.mode === "on" ? <Link href="/makeups/new" className="bg-primary inline-flex min-h-8 items-center rounded-md px-3 text-white">보강 접수</Link> : null}
    </div>} />
    {settings.makeups.mode === "draining" ? <p role="status" className="border-line rounded-lg border p-3">새 접수를 중지했습니다. 기존 보강·대사·인계 업무를 처리해 주세요.</p> : null}
    <MakeupListToolbar filter={filter} subjects={settings.operations.subjects} />
    {!result.data ? <div role="alert" className="border-line space-y-3 rounded-lg border p-4"><p>{result.error}</p>
      <Link href={`/makeups?${new URLSearchParams(filter)}`} className="text-primary underline">다시 조회</Link></div>
      : <MakeupCaseTable data={result.data} subjects={buildSubjectMaps(settings.operations.subjects)} filter={filter} />}
  </div>;
}
