import { EmbedLink as Link } from "@/components/embed-link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { getMakeupCaseDetail } from "@/features/makeups/server/queries";
import { CaseDetailView } from "@/features/makeups/components/case-detail-view";

export const metadata = { title: "보강관리 · 상세 — 에이와" };
export default async function MakeupCasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAccess("makeups");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [result, settings] = await Promise.all([getMakeupCaseDetail(id), getTenantSettings()]);
  if (!result.data) return <div className="space-y-4 p-4"><p role="alert">{result.error}</p>
    <Link href={`/makeups/${id}`} className="text-primary underline">다시 조회</Link><Link href="/makeups" className="text-primary ml-4 underline">목록</Link></div>;
  const detail = result.data, subjects = buildSubjectMaps(settings.operations.subjects), periods = settingsToPeriodsConfig(settings.operations);
  return <div className="space-y-4 pb-6">
    <PageHeader title={`${detail.case.student_name} · 보강`} description={subjects.labelOf(detail.case.subject_key)}
      actions={<Link href="/makeups" className="text-primary inline-block min-h-6 underline">목록</Link>} />
    <CaseDetailView initial={detail} periods={periods} actorId={actor.id} reserveOn={settings.makeups.mode === "on"} />
  </div>;
}
