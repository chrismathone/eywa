import { requireAccess } from "@/lib/auth/require-access";
import {
  getAbsenceRiskStudents,
  getActiveConsultationsCount,
  getEnrolledStudentCount,
  getMostRecentAttendanceSnapshot,
  getNewStudentsThisMonth,
  getPaymentRateThisMonth,
  getTrendDataLast7Days,
  getWithdrawalsThisMonth,
} from "@/features/dashboard/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { buildActionItems, enrollmentDelta } from "@/features/dashboard/metrics";
import { CommandBand } from "./_components/command-band";
import { NowCockpit } from "./_components/now-cockpit";
import { ActionStack } from "./_components/action-stack";
import { SlimTrend } from "./_components/slim-trend";

export const metadata = { title: "대시보드 — eywa" };

export default async function DashboardPage() {
  const user = await requireAccess("dashboard");
  const [
    enrolled,
    newThisMonth,
    withdrawnThisMonth,
    attendance,
    trend,
    todaySchedule,
    payment,
    consultations,
    absenceRisks,
  ] = await Promise.all([
    getEnrolledStudentCount(),
    getNewStudentsThisMonth(),
    getWithdrawalsThisMonth(),
    getMostRecentAttendanceSnapshot(),
    getTrendDataLast7Days(),
    getTodaySchedule(),
    getPaymentRateThisMonth(),
    getActiveConsultationsCount(),
    getAbsenceRiskStudents(),
  ]);

  const name = user.displayName ?? "원장";
  const attendanceRate = attendance && attendance.total > 0 ? attendance.rate : null;
  const paymentRate = payment && payment.totalCount > 0 ? payment.paymentRate : null;
  const unpaidCount = payment?.unpaidCount ?? 0;

  const actions = buildActionItems({
    unpaidCount,
    absenceRisk: absenceRisks.length,
    aiWaiting: consultations.aiDone,
    newConsults: consultations.pending + consultations.scheduled,
  });

  return (
    <div className="space-y-4">
      {/* ① 커맨드 밴드 */}
      <CommandBand
        name={name}
        enrolled={enrolled}
        enrolledDelta={enrollmentDelta(newThisMonth, withdrawnThisMonth)}
        attendanceRate={attendanceRate}
        paymentRate={paymentRate}
        unpaidCount={unpaidCount}
      />

      {/* ② 지금 콕핏 + ③ 처리 필요 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <NowCockpit slots={todaySchedule} />
        <ActionStack items={actions} />
      </div>

      {/* ④ 슬림 7일 추세 */}
      <SlimTrend data={trend} />
    </div>
  );
}
