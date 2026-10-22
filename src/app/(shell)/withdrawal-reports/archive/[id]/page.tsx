import { reportViewer } from "@/features/withdrawal-reports/server/queries";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getArchive, archiveStudents } from "@/features/withdrawal-reports/server/archives";
import { ArchiveDetailView } from "../../_components/archive-detail";
export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("withdrawal_reports");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [archive, students, viewer] = await Promise.all([getArchive(id), archiveStudents(), reportViewer()]);
  if (!archive) notFound();
  return <div className="min-w-0 space-y-5 p-4 md:p-6"><ArchiveDetailView key={`${archive.id}:${archive.revision}`} archive={archive} students={students} canManage={viewer?.request} /></div>;
}
