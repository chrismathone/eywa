import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getReport, reportViewer, reportStaff, reportSubjectLabels } from "@/features/withdrawal-reports/server/queries";
import { withdrawalDetailHref } from "@/features/withdrawals/server/detail-href";
import { ReportDetail } from "../_components/report-detail";
import { cancelsAsDirector, isParticipant } from "@/features/withdrawal-reports/model";

export const metadata = { title: "퇴원보고서 — 에이와" };
export default async function WithdrawalReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("withdrawal_reports");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [record, viewer, staff, labels] = await Promise.all([getReport(id), reportViewer(), reportStaff(), reportSubjectLabels()]);
  if (!record || !viewer) notFound();
  // '퇴원 상세' 링크 — 학생 id가 보고서에서 나오니 그 뒤에 묻는다(학생 상태 한 줄 조회).
  const withdrawalHref = await withdrawalDetailHref(record.report.student_id);
  return <div className="min-w-0 space-y-5 p-4 md:p-6">
    <PageHeader title={`${record.report.snapshot.name} · 퇴원보고서`} description="요청 당시의 학생·수강 정보를 기준으로 검토합니다." />
    {/* 승인자·요청자·작성자가 아닌 열람(원장·관리자급 — 원장 2026-10-30 "요청서 승인이 없어도 '열람'형식으로") — 버튼은 원래 권한대로 숨는다. */}
    {!viewer.teacherId && !isParticipant(record.report, viewer.user.id) ? (
      <p className="border-line text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-sm">열람 — 이 보고서의 승인자로 지정되지 않았습니다. 승인은 지정된 사람만 할 수 있습니다.</p>
    ) : null}
    <ReportDetail key={`${record.report.id}:${record.report.status}`} {...record} staff={staff} labels={labels} userId={viewer.user.id} writable={viewer.writable} directorLevel={cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId)} withdrawalHref={withdrawalHref} />
  </div>;
}
