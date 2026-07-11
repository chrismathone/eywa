import { requireAccess } from "@/lib/auth/require-access";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import {
  getAbsenceRiskStudents,
  getActiveEnrollmentConsultations,
  getAnnouncementsForManage,
  getEnrolledStudentCount,
  getFollowUpConsultations,
  getMonthlyEnrollmentChanges,
  getMostRecentAttendanceSnapshot,
  getPaymentRateThisMonth,
  getRecentAnnouncements,
  getTodayRecordedClassIds,
  getTopOutstanding,
  getTrendDataLast7Days,
  getUnassignedEnrolledStudents,
} from "@/features/dashboard/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { kstToday } from "@/lib/date-kst";
import { getTodayActionSignals } from "@/features/dashboard/server/action-signals";
import { buildTodayActions } from "@/features/dashboard/today-actions";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { enrollmentDelta } from "@/features/dashboard/metrics";
import { CommandBand } from "./_components/command-band";
import { QuickActions } from "./_components/quick-actions";
import { TodayActionsBand } from "./_components/today-actions-band";
import { NowCockpit } from "./_components/now-cockpit";
import { AbsenceRiskCard } from "./_components/absence-risk-card";
import { OutstandingCard } from "./_components/outstanding-card";
import { EnrollmentListCard } from "./_components/enrollment-list-card";
import { FollowUpCard } from "./_components/followup-card";
import { AnnouncementsCard } from "./_components/announcements-card";
import { SlimTrend } from "./_components/slim-trend";

export const metadata = { title: "대시보드 — eywa" };

export default async function DashboardPage() {
  const user = await requireAccess("dashboard");
  const canManageAnnouncements = canManageStaff(user.systemRole);
  const [
    enrolled,
    attendance,
    trend,
    todaySchedule,
    payment,
    enrollList,
    absenceRisks,
    outstanding,
    recentAnnouncements,
    manageAnnouncements,
    followUps,
    recordedClassIds,
    settings,
    enrollmentChanges,
    actionSignals,
    unassignedEnrolled,
  ] = await Promise.all([
    getEnrolledStudentCount(),
    getMostRecentAttendanceSnapshot(),
    getTrendDataLast7Days(),
    getTodaySchedule(),
    getPaymentRateThisMonth(),
    getActiveEnrollmentConsultations(),
    getAbsenceRiskStudents(),
    getTopOutstanding(),
    // 관리 권한이면 관리 목록(상위집합)에서 카드 4건을 도출 → 이중 fetch 제거. 아니면 카드용 4건만.
    canManageAnnouncements ? Promise.resolve(null) : getRecentAnnouncements(4),
    canManageAnnouncements ? getAnnouncementsForManage() : Promise.resolve([]),
    getFollowUpConsultations(8),
    getTodayRecordedClassIds(),
    getTenantSettings(),
    getMonthlyEnrollmentChanges(),
    getTodayActionSignals(),
    getUnassignedEnrolledStudents(),
  ]);
  const announcements = recentAnnouncements ?? manageAnnouncements.slice(0, 4);
  // "오늘 조치할 것" 불릿 — 전부 0건이면 빈 배열(패널이 '정상' 한 줄 표시).
  const todayActions = buildTodayActions(actionSignals);
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 콕핏에 prop 주입(하드코딩 금지).
  const subjects = buildSubjectMaps(settings.operations.subjects);

  // 오늘 시작한(예정 제외) 수업 중 출석 미기록 수.
  const recordedSet = new Set(recordedClassIds);
  const unrecordedCount = todaySchedule.filter(
    (s) => s.status !== "upcoming" && !recordedSet.has(s.classId),
  ).length;

  const name = user.displayName ?? "선생";
  // 인사말 호칭 — 본인 직급(job_title) 우선, 없으면 역할 기반 한국어 호칭(누구나 "원장님" 금지).
  const HONORIFIC: Record<string, string> = {
    master: "원장",
    admin: "관리자",
    manager: "실장",
    accountant: "회계",
    counselor: "상담",
    teacher: "선생",
    viewer: "선생",
  };
  const honorific = user.jobTitle?.trim() || HONORIFIC[user.systemRole] || "선생";
  const attendanceRate = attendance && attendance.total > 0 ? attendance.rate : null;
  // 출석 스냅샷이 과거일 폴백이면 기준일을 정직하게 표기("M/D 기준") — 오래된 100%가 오늘처럼 보이는 것 방지.
  const attendanceAsOf =
    attendance && attendance.date !== kstToday()
      ? `${Number(attendance.date.slice(5, 7))}/${Number(attendance.date.slice(8, 10))}`
      : null;
  const paymentRate = payment && payment.totalCount > 0 ? payment.paymentRate : null;
  const unpaidCount = payment?.unpaidCount ?? 0;

  return (
    <div className="space-y-4">
      {/* ① 커맨드 밴드 */}
      <CommandBand
        name={name}
        honorific={honorific}
        enrolled={enrolled}
        enrolledDelta={enrollmentDelta(
          enrollmentChanges.newStudents.length,
          enrollmentChanges.withdrawn.length,
        )}
        attendanceRate={attendanceRate}
        attendanceAsOf={attendanceAsOf}
        paymentRate={paymentRate}
        unpaidCount={unpaidCount}
        outstanding={payment?.outstanding ?? 0}
        newStudents={enrollmentChanges.newStudents}
        withdrawn={enrollmentChanges.withdrawn}
      />

      {/* 빠른 작업 */}
      <QuickActions />

      {/* 오늘 조치할 것 — 조건부 신호 통합 패널(0건이면 '정상' 한 줄) */}
      <TodayActionsBand items={todayActions} />

      {/* ② 운영 콕핏 — 지금(1.6fr) · 학생 위험/수납(1fr) · 상담/공지(1fr).
          ⚠️ minmax(0,Nfr): 그냥 Nfr은 min=min-content라 한 컬럼의 긴 내용이 다른 컬럼을 굶겨(좁은 창에서
          좌측 콕핏이 ~50px로 짜부) → min=0으로 비례(1.6:1:1) 나눔 강제. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
        <NowCockpit slots={todaySchedule} subjects={subjects} unrecordedCount={unrecordedCount} />
        <div className="flex flex-col gap-4">
          <AbsenceRiskCard items={absenceRisks} />
          <OutstandingCard items={outstanding} />
          <FollowUpCard items={followUps} />
        </div>
        <div className="flex flex-col gap-4">
          <EnrollmentListCard list={enrollList} unassigned={unassignedEnrolled} />
          <AnnouncementsCard
            items={announcements}
            canManage={canManageAnnouncements}
            manageItems={manageAnnouncements}
          />
        </div>
      </div>

      {/* ③ 슬림 7일 추세 */}
      <SlimTrend data={trend} />
    </div>
  );
}
