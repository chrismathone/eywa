import { reportViewer } from "@/features/withdrawal-reports/server/queries";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getArchive, archiveStudents } from "@/features/withdrawal-reports/server/archives";
import { withdrawalDetailHref } from "@/features/withdrawals/server/detail-href";
import { ArchiveDetailView } from "../../_components/archive-detail";
export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("withdrawal_reports");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [archive, students, viewer] = await Promise.all([getArchive(id), archiveStudents(), reportViewer()]);
  if (!archive) notFound();
  // '퇴원 상세' 링크 — 연결된 학생이 원본에서 나오니 그 뒤에 묻는다(학생 상태 한 줄 조회).
  const withdrawalHref = await withdrawalDetailHref(archive.mapped_student_id);
  return <div className="min-w-0 space-y-5 p-4 md:p-6"><ArchiveDetailView key={`${archive.id}:${archive.revision}`} archive={archive} students={students} canManage={viewer?.request} withdrawalHref={withdrawalHref} /></div>;
}
