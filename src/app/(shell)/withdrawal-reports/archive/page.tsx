import { notFound } from "next/navigation";
import { EmbedLink } from "@/components/embed-link";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { reportViewer } from "@/features/withdrawal-reports/server/queries";
import { listArchives } from "@/features/withdrawal-reports/server/archives";
import { ArchiveList } from "../_components/archive-list";
export default async function ArchivesPage() {
  await requireAccess("withdrawal_reports");
  if (!(await reportViewer())?.request) notFound();
  const rows = await listArchives();
  return <div className="min-w-0 space-y-5 p-4 md:p-6"><PageHeader eyebrow="실험실" title="기존 퇴원보고서" description="스프레드시트의 원문을 보관합니다. 연결되지 않은 기록은 학생을 확인한 뒤 연결할 수 있습니다." /><EmbedLink href="/withdrawal-reports" className="text-sm text-primary hover:underline">← 작성·승인 보고서</EmbedLink><ArchiveList rows={rows} /></div>;
}
