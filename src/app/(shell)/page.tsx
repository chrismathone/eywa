import {
  getActiveConsultationsCount,
  getCurrentUserProfile,
  getEnrolledStudentCount,
  getMostRecentAttendanceSnapshot,
  getNewStudentsThisMonth,
  getPaymentRateThisMonth,
  getRecentAnnouncements,
  getTrendDataLast7Days,
  getWithdrawalsThisMonth,
} from "@/features/dashboard/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { AnnouncementsCard } from "./_components/announcements-card";
import { DashboardHero } from "./_components/dashboard-hero";
import { KpiGrid } from "./_components/kpi-grid";
import { TodayTimeline } from "./_components/today-timeline";
import { TrendCard } from "./_components/trend-card";

export const metadata = { title: "대시보드 — eywa" };

export default async function DashboardPage() {
  const [
    profile,
    enrolled,
    newThisMonth,
    withdrawnThisMonth,
    attendance,
    announcements,
    trend,
    todaySchedule,
    payment,
    consultations,
  ] = await Promise.all([
    getCurrentUserProfile(),
    getEnrolledStudentCount(),
    getNewStudentsThisMonth(),
    getWithdrawalsThisMonth(),
    getMostRecentAttendanceSnapshot(),
    getRecentAnnouncements(),
    getTrendDataLast7Days(),
    getTodaySchedule(),
    getPaymentRateThisMonth(),
    getActiveConsultationsCount(),
  ]);

  const name = profile?.displayName ?? "원장";

  return (
    <div className="space-y-8">
      <DashboardHero name={name} enrolledStudents={enrolled} />
      <KpiGrid
        enrolled={enrolled}
        newThisMonth={newThisMonth}
        withdrawnThisMonth={withdrawnThisMonth}
        attendance={attendance}
        payment={payment}
        consultations={consultations}
        trend={trend}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <AnnouncementsCard announcements={announcements} />
        </div>
        <div className="xl:col-span-2">
          <TodayTimeline slots={todaySchedule} />
        </div>
      </div>
      <TrendCard data={trend} />
    </div>
  );
}
