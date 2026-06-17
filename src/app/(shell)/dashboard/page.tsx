import { requireAccess } from "@/lib/auth/require-access";
import {
  getAbsenceRiskStudents,
  getActiveConsultationsCount,
  getEnrolledStudentCount,
  getMostRecentAttendanceSnapshot,
  getNewStudentsThisMonth,
  getPaymentRateThisMonth,
  getRecentAnnouncements,
  getTopOutstanding,
  getTrendDataLast7Days,
  getWithdrawalsThisMonth,
} from "@/features/dashboard/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { enrollmentDelta } from "@/features/dashboard/metrics";
import { CommandBand } from "./_components/command-band";
import { NowCockpit } from "./_components/now-cockpit";
import { AbsenceRiskCard } from "./_components/absence-risk-card";
import { OutstandingCard } from "./_components/outstanding-card";
import { ConsultationFunnel } from "./_components/consultation-funnel";
import { AnnouncementsCard } from "./_components/announcements-card";
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
    outstanding,
    announcements,
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
    getTopOutstanding(),
    getRecentAnnouncements(4),
  ]);

  const name = user.displayName ?? "원장";
  const attendanceRate = attendance && attendance.total > 0 ? attendance.rate : null;
  const paymentRate = payment && payment.totalCount > 0 ? payment.paymentRate : null;
  const unpaidCount = payment?.unpaidCount ?? 0;

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

      {/* ② 운영 콕핏 — 지금(1.6fr) · 학생 위험/수납(1fr) · 상담/공지(1fr) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr_1fr] lg:items-stretch">
        <NowCockpit slots={todaySchedule} />
        <div className="flex flex-col gap-4">
          <AbsenceRiskCard items={absenceRisks} />
          <OutstandingCard items={outstanding} />
        </div>
        <div className="flex flex-col gap-4">
          <ConsultationFunnel pipeline={consultations} />
          <AnnouncementsCard items={announcements} />
        </div>
      </div>

      {/* ③ 슬림 7일 추세 */}
      <SlimTrend data={trend} />
    </div>
  );
}
