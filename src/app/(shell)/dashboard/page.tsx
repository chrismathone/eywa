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
  getEnrollmentChangeLast7d,
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
    enrollmentChange,
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
    getEnrollmentChangeLast7d(),
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
  // 출석 스냅샷 신선도 — 최근 기록이 7일 넘게 오래되면(예: eywa 출석 입력 중단) 낡은 비율(9건짜리 100% 등)이
  // 현재처럼 크게 보이지 않게 rate를 숨기고("—"), 밴드 서브에 "M/D 이후 기록 없음"으로 정직하게 표기.
  const attStaleDays = attendance
    ? Math.floor((Date.parse(`${kstToday()}T00:00:00Z`) - Date.parse(`${attendance.date}T00:00:00Z`)) / 86_400_000)
    : 0;
  const attendanceStale = attStaleDays > 7;
  const attendanceRate = attendance && attendance.total > 0 && !attendanceStale ? attendance.rate : null;
  const attendanceAsOf =
    attendance && attendance.date !== kstToday()
      ? (() => {
          const md = `${Number(attendance.date.slice(5, 7))}/${Number(attendance.date.slice(8, 10))}`;
          return attendanceStale ? `${md} 이후 기록 없음` : `${md} 기준`;
        })()
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

      {/* 최근 7일 — 학생 증감(전체·과목별 차트) 주역 + 출석·수납 추세 (원장 요청: 오늘 조치 아래로) */}
      <SlimTrend data={trend} change={enrollmentChange} subjects={subjects} />

      {/* ② 운영 콕핏 — 높이가 제각각인 카드들을 자연 높이 그대로 CSS 다단(columns) balanced-fill로
          촘촘히 재배치(테트리스 packing). ⚠️ CSS Grid 기본이 align:stretch라 짧은 카드가 가장 큰 카드
          높이까지 늘어나 거대한 빈칸을 만들었다(오늘일정 히어로 옆 결석위험이 통째로 늘어남) → 다단은
          카드를 늘리지 않고 높이순으로 균형 있게 채운다. break-inside-avoid로 카드는 열 경계에서 안 쪼개짐. */}
      <div className="columns-1 gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <NowCockpit slots={todaySchedule} subjects={subjects} unrecordedCount={unrecordedCount} />
        <AbsenceRiskCard items={absenceRisks} />
        <OutstandingCard items={outstanding} />
        <FollowUpCard items={followUps} />
        <EnrollmentListCard list={enrollList} unassigned={unassignedEnrolled} />
        <AnnouncementsCard
          items={announcements}
          canManage={canManageAnnouncements}
          manageItems={manageAnnouncements}
        />
      </div>
    </div>
  );
}
