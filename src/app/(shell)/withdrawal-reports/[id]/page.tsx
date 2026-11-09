import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getReport, reportViewer, reportStaff, reportSubjectLabels } from "@/features/withdrawal-reports/server/queries";
import { withdrawalDetailHref } from "@/features/withdrawals/server/detail-href";
import { ReportDetail } from "../_components/report-detail";
import { ReportPageBanner } from "../_components/report-page-banner";
import { canRequestRefund, cancelsAsDirector, isParticipant } from "@/features/withdrawal-reports/model";
import { decisionWaitingOf } from "@/features/withdrawal-reports/refund-detail-notes";

export const metadata = { title: "퇴원보고서 — 에이와" };
export default async function WithdrawalReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("withdrawal_reports");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [record, viewer, staff, labels] = await Promise.all([getReport(id), reportViewer(), reportStaff(), reportSubjectLabels()]);
  if (!record || !viewer) notFound();
  // '퇴원 상세' 링크 — 학생 id가 보고서에서 나오니 그 뒤에 묻는다(학생 상태 한 줄 조회).
  const withdrawalHref = await withdrawalDetailHref(record.report.student_id);
  const directorLevel = cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId);
  // 원장 환불 결정 차례(리뷰 r2 m8) — '내 환불 결정 필요'로 들어온 원장이 맨 위에서 '승인자로 지정되지 않았습니다'를 보고 헤매지 않게, 결정 자리(`#refund`)로 안내한다.
  const director = canRequestRefund(record.report, viewer.writable, directorLevel);
  const decisionTurn = director && decisionWaitingOf(record.report.status, record.refundDecision.hold, record.refundDecision.undecided) && record.refundDecision.undecided.length > 0;
  // 목록은 '환불 결정 대기'인데 지금 계산엔 정할 건이 없다(리뷰 r3 R2-I1) — '열람 — 승인자로 지정되지 않았습니다' 대신 그 사실과 다시 판정 자리를.
  const recheckTurn = director && record.refundDecision.gap === "db";
  // 승인자·요청자·작성자가 아닌 열람(원장·관리자급) — 버튼은 원래 권한대로 숨는다.
  const banner = decisionTurn ? "decision" : recheckTurn ? "recheck" : !viewer.teacherId && !isParticipant(record.report, viewer.user.id) ? "view" : null;
  return <div className="min-w-0 space-y-5 p-4 md:p-6">
    <PageHeader title={`${record.report.snapshot.name} · 퇴원보고서`} description="요청 당시의 학생·수강 정보를 기준으로 검토합니다." />
    <ReportPageBanner kind={banner} />
    <ReportDetail key={`${record.report.id}:${record.report.status}`} {...record} staff={staff} labels={labels} userId={viewer.user.id} writable={viewer.writable} directorLevel={cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId)} withdrawalHref={withdrawalHref} />
  </div>;
}
