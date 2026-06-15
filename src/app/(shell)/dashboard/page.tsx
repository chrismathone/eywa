import { requireAccess } from "@/lib/auth/require-access";
import {
  getAbsenceRiskStudents,
  getActiveConsultationsCount,
  getEnrolledStudentCount,
  getMostRecentAttendanceSnapshot,
  getNewStudentsThisMonth,
  getPaymentRateThisMonth,
  getRecentAnnouncements,
  getTrendDataLast7Days,
  getUpcomingPayments,
  getWithdrawalsThisMonth,
} from "@/features/dashboard/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { AnnouncementsCard } from "./_components/announcements-card";
import { DashboardHero } from "./_components/dashboard-hero";
import { KpiGrid } from "./_components/kpi-grid";
import { TodayTimeline } from "./_components/today-timeline";
import { TrendCard } from "./_components/trend-card";
import { UpcomingPaymentsCard } from "./_components/upcoming-payments-card";
import { AbsenceRiskCard } from "./_components/absence-risk-card";

export const metadata = { title: "대시보드 — eywa" };

export default async function DashboardPage() {
  const user = await requireAccess("dashboard");
  const [
    enrolled,
    newThisMonth,
    withdrawnThisMonth,
    attendance,
    announcements,
    trend,
    todaySchedule,
    payment,
    consultations,
    upcomingPayments,
    absenceRisks,
  ] = await Promise.all([
    getEnrolledStudentCount(),
    getNewStudentsThisMonth(),
    getWithdrawalsThisMonth(),
    getMostRecentAttendanceSnapshot(),
    getRecentAnnouncements(),
    getTrendDataLast7Days(),
    getTodaySchedule(),
    getPaymentRateThisMonth(),
    getActiveConsultationsCount(),
    getUpcomingPayments(7),
    getAbsenceRiskStudents(),
  ]);

  const name = user.displayName ?? "원장";
  const attendanceDelta =
    attendance && attendance.total > 0 ? `${attendance.rate.toFixed(1)}%` : null;

  return (
    <div className="space-y-4">
      <DashboardHero
        name={name}
        enrolledStudents={enrolled}
        attendanceDelta={attendanceDelta}
        unpaidCount={payment?.unpaidCount}
      />
      <KpiGrid
        enrolled={enrolled}
        newThisMonth={newThisMonth}
        withdrawnThisMonth={withdrawnThisMonth}
        attendance={attendance}
        payment={payment}
        consultations={consultations}
        trend={trend}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
        <TodayTimeline slots={todaySchedule} />
        <AnnouncementsCard announcements={announcements} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UpcomingPaymentsCard items={upcomingPayments} />
        <AbsenceRiskCard items={absenceRisks} />
      </div>
      <TrendCard data={trend} />
    </div>
  );
}
