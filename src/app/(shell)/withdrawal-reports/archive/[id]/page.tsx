import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getArchive, archiveStudents } from "@/features/withdrawal-reports/server/archives";
import { ArchiveDetailView } from "../../_components/archive-detail";
export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("withdrawal_reports");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [archive, students] = await Promise.all([getArchive(id), archiveStudents()]);
  if (!archive) notFound();
  return <div className="space-y-5 p-4 md:p-6"><ArchiveDetailView key={`${archive.id}:${archive.revision}`} archive={archive} students={students} /></div>;
}
