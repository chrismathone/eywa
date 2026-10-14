import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { listReports, reportViewer, reportStaff, requestStudents, reportSubjectLabels } from "@/features/withdrawal-reports/server/queries";
import { ReportList } from "./_components/report-list";
import { EmbedLink } from "@/components/embed-link";

export const metadata = { title: "퇴원보고서 — 에이와" };
export default async function WithdrawalReportsPage() {
  await requireAccess("withdrawal_reports");
  const viewer = await reportViewer();
  if (!viewer) notFound();
  const [list, staff, students, labels] = await Promise.all([listReports(), reportStaff(), requestStudents(), reportSubjectLabels()]);
  return <div className="min-w-0 space-y-5 p-4 md:p-6">
    <PageHeader eyebrow="실험실" title="퇴원보고서" description="관리자가 작성을 요청하고, 강사별로 보고서를 제출합니다. 원장을 선택하지 않으면 관리자가 최종 승인합니다." />
    {viewer.request && <EmbedLink href="/withdrawal-reports/archive" className="inline-block text-sm text-primary hover:underline">기존 스프레드시트 보고서 보기 →</EmbedLink>}
    {list.available ? <ReportList reports={list.rows} completedLimited={list.completedLimited} staff={staff} students={students} labels={labels} userId={viewer.user.id} canRequest={viewer.request} scope={viewer.scope} />
      : <p className="rounded-lg border bg-muted/30 p-6 text-sm">퇴원보고서 기능을 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>}
  </div>;
}
