import { requireAccess } from "@/lib/auth/require-access";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWrite } from "@/lib/permissions";
import {
  getAbsenceRiskCached,
  getActiveEnrollmentConsultations,
  getAnnouncementsForManage,
  getEnrolledStudentCount,
  getFollowUpConsultations,
  getMonthlyEnrollmentChanges,
  getDashboardAttendanceState,
  getPaymentRateThisMonth,
  getRecentAnnouncements,
  getTopOutstandingCached,
  getTrendDataLast7Days,
  getEnrollmentChangeLast7d,
} from "@/features/dashboard/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { kstToday } from "@/lib/date-kst";
import { getTodayActionSignals } from "@/features/dashboard/server/action-signals";
import { getDailyBriefing, type DailyBriefingRow } from "@/features/dashboard/server/briefing";
import {
  getLatestAssistantConversation,
  type AssistantConversation,
} from "@/features/assistant/server/queries";
import { buildTodayActions } from "@/features/dashboard/today-actions";
import { buildOperationsBriefing } from "@/features/dashboard/operations-briefing";
import { resolveDashboardAccess, todayActionGate } from "@/features/dashboard/dashboard-access";
import { buildBriefingLinks } from "@/features/dashboard/briefing-links";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { enrollmentDelta } from "@/features/dashboard/metrics";
import { CommandBand } from "./_components/command-band";
import { QuickActions } from "./_components/quick-actions";
import { OperationsBriefing } from "./_components/operations-briefing";
import { DailyBriefingCard } from "./_components/daily-briefing-card";
import { AssistantPanel } from "./_components/assistant-panel";
import { NowCockpit } from "./_components/now-cockpit";
import { OutstandingCard } from "./_components/outstanding-card";
import { EnrollmentListCard } from "./_components/enrollment-list-card";
import { FollowUpCard } from "./_components/followup-card";
import { AnnouncementsCard } from "./_components/announcements-card";
import { SlimTrend } from "./_components/slim-trend";
import type { QuickActionKey } from "./_components/quick-actions";

const EMPTY_ENROLLMENT_CHANGES = {
  newCount: 0,
  withdrawnCount: 0,
  newStudents: [],
  withdrawn: [],
};
const EMPTY_ENROLLMENT_LIST = { total: 0, rows: [] };
const EMPTY_ENROLLMENT_CHANGE = {
  days: 7,
  newCount: 0,
  withdrawnCount: 0,
  net: 0,
  bySubject: [],
};

type DashboardQueryResult<T> = { data: T; unavailable: boolean };

async function dashboardQuery<T>(label: string, query: Promise<T>, fallback: T): Promise<DashboardQueryResult<T>> {
  try {
    return { data: await query, unavailable: false };
  } catch (error) {
    console.error(`[dashboard] ${label} query failed`, error);
    return { data: fallback, unavailable: true };
  }
}

export const metadata = { title: "운영실 — eywa" };
// AI 비서(askAssistant) 툴 루프가 이 라우트로 POST된다 — 다중 툴 왕복(수 초~수십 초) 여유.
export const maxDuration = 60;

export default async function TodayPage() {
  const user = await requireAccess("dashboard");
  // requireAccess에서 이미 읽은 요청 캐시 재사용 — 추가 DB 왕복 없이 브리핑 링크를 역할별로 거른다.
  const permissionMatrix = await getPermMatrix();
  const access = resolveDashboardAccess(user.systemRole, permissionMatrix);
  const canManageAnnouncements =
    canManageStaff(user.systemRole) && canWrite(user.systemRole, "dashboard", permissionMatrix);
  // 일일 브리핑은 master/admin/manager 전용 — payload가 master 관점 전신호(미수·결재 포함)라
  // scoped 역할(counselor/accountant)에는 카드 자체를 렌더하지 않는다(#77, 0114a 주석 참조).
  const canSeeDailyBriefing = canManageStaff(user.systemRole);
  // 비서 패널 노출 = 액션 게이트(askAssistant: canManageStaff + dashboard write)와 동일 조건(#77) —
  // 노출만 넓으면 readonly 관리자에게 '항상 권한 오류 나는 죽은 패널'이 보인다(적대 리뷰 확정).
  const canUseAssistant = canSeeDailyBriefing && canWrite(user.systemRole, "dashboard", permissionMatrix);
  const [
    enrolled,
    attendanceState,
    trend,
    todaySchedule,
    payment,
    enrollListResult,
    absenceRisks,
    outstanding,
    recentAnnouncementsResult,
    manageAnnouncementsResult,
    followUpsResult,
    settings,
    enrollmentChangesResult,
    actionSignals,
    enrollmentChange,
    dailyBriefingResult,
    assistantConversationResult,
  ] = await Promise.all([
    access.read.students ? getEnrolledStudentCount() : Promise.resolve(0),
    access.read.attendance
      ? getDashboardAttendanceState()
      : Promise.resolve({
          snapshot: null,
          todayProcessing: [],
          snapshotProcessing: [],
          snapshotIssue: false,
          todayProcessingIssue: false,
          snapshotProcessingIssue: false,
        }),
    access.read.attendance || access.read.billing
      ? getTrendDataLast7Days({ attendance: access.read.attendance, billing: access.read.billing })
      : Promise.resolve([]),
    access.read.timetable || access.read.classes || access.read.attendance
      ? getTodaySchedule()
      : Promise.resolve([]),
    access.read.billing ? getPaymentRateThisMonth() : Promise.resolve(null),
    // 쿼리 실패를 빈 데이터('상담 없음'/'±0'/'공지 없음')로 위장하지 않게 실패 허용 래퍼로 감싼다 —
    // 쿼리 자체는 error를 throw(위장 금지)하고, 카드는 fallback으로 렌더하되 실패가 로그에 남는다.
    access.read.enrollment
      ? dashboardQuery("enrollment consultations", getActiveEnrollmentConsultations(), EMPTY_ENROLLMENT_LIST)
      : Promise.resolve({ data: EMPTY_ENROLLMENT_LIST, unavailable: false }),
    // ⚠️ 캐시본(60초)은 admin 클라이언트라 RLS를 안 탄다 — **이 줄의 권한 분기가 곧 게이트다**(queries.ts 주석).
    //    분기를 지우거나 캐시본을 게이트 없는 자리로 옮기지 말 것.
    access.read.students && access.read.attendance
      ? getAbsenceRiskCached(user.tenantId)
      : Promise.resolve([]),
    access.read.billing ? getTopOutstandingCached(user.tenantId) : Promise.resolve([]),
    // 관리 목록은 30건으로 잘리므로 카드용 역할 필터 쿼리를 별도로 유지해야 대상 공지가 누락되지 않는다.
    dashboardQuery("recent announcements", getRecentAnnouncements(user.systemRole, 4), []),
    canManageAnnouncements
      ? dashboardQuery("announcements manage", getAnnouncementsForManage(), [])
      : Promise.resolve({ data: [], unavailable: false }),
    access.read.consultations
      ? dashboardQuery("consultation follow-ups", getFollowUpConsultations(8), [])
      : Promise.resolve({ data: [], unavailable: false }),
    getTenantSettings(),
    access.read.students
      ? dashboardQuery("monthly enrollment changes", getMonthlyEnrollmentChanges(), EMPTY_ENROLLMENT_CHANGES)
      : Promise.resolve({ data: EMPTY_ENROLLMENT_CHANGES, unavailable: false }),
    getTodayActionSignals({
      students: access.write.students,
      attendance: access.read.attendance,
      meetings: access.write.meetings,
      enrollment: access.write.enrollment,
      consultations: access.write.consultations,
      lessonReports: access.read.lessonReports,
      billing: access.write.billing,
      staff: access.read.staff,
      staffApprovals: access.manageStaff,
      owner: access.read.owner,
    }),
    access.read.students ? getEnrollmentChangeLast7d() : Promise.resolve(EMPTY_ENROLLMENT_CHANGE),
    // 저장분 조회만(AI 호출 없음). 테이블 미적용 DB에서도 대시보드가 죽지 않게 실패 허용 래퍼.
    canSeeDailyBriefing
      ? dashboardQuery<DailyBriefingRow | null>("daily briefing", getDailyBriefing(user.tenantId, kstToday()), null)
      : Promise.resolve({ data: null, unavailable: false }),
    canSeeDailyBriefing
      ? dashboardQuery<AssistantConversation | null>(
          "assistant conversation",
          getLatestAssistantConversation(),
          null,
        )
      : Promise.resolve({ data: null, unavailable: false }),
  ]);
  const attendance = attendanceState.snapshot;
  const followUps = followUpsResult.data;
  const enrollList = enrollListResult.data;
  const announcements = recentAnnouncementsResult.data;
  const manageAnnouncements = manageAnnouncementsResult.data;
  const enrollmentChanges = enrollmentChangesResult.data;

  // 출결 신선도는 브리핑과 계기판이 같은 KST 기준을 공유한다. 오래된 출결로 학생을
  // 현재 긴급 위험처럼 보이지 않게 브리핑 조립 전에 계산한다.
  const today = kstToday();
  const attStaleDays = attendance
    ? Math.max(
        0,
        Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${attendance.date}T00:00:00Z`)) / 86_400_000),
      )
    : null;
  const attendanceStale = attStaleDays !== null && attStaleDays > 7;
  const briefingAttendanceUnavailable =
    attendanceState.snapshotIssue ||
    attendanceState.todayProcessingIssue ||
    attendanceState.snapshotProcessingIssue;

  // 기존 운영 신호 + 이미 조회한 상담 후속/반복 결석 preview를 읽기 전용 브리핑으로 조립.
  // 새 쿼리나 AI 호출 없이 순수 계산만 하며, 서로 단위가 다른 count는 합산하지 않는다.
  // 과목 라벨은 학원설정 단일 소스(하드코딩 금지) — 아래 콕핏에 넘기는 것과 같은 맵을 신호에도 준다.
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 조치 화면 열람 판정은 브리핑 바로 가기 칩과 **같은 술어**를 쓴다(갈리면 죽은 링크가 생긴다).
  const canOpenAction = todayActionGate(user.systemRole, permissionMatrix, access);
  const todayActions = buildTodayActions(actionSignals, { subjectLabel: subjectMaps.labelOf }).filter((item) =>
    canOpenAction(item.menuKey, item.requiredAccess),
  );
  // 일일 브리핑 '바로 가기' — 결정론 payload의 신호만 링크로(문장 파싱 없음, briefing-links 주석).
  const briefingLinks = canSeeDailyBriefing
    ? buildBriefingLinks(dailyBriefingResult.data?.payload ?? null, canOpenAction)
    : null;
  const briefing = buildOperationsBriefing({
    actions: todayActions,
    followUps: access.read.consultations ? followUps : [],
    followUpsUnavailable: access.read.consultations && followUpsResult.unavailable,
    absenceRisks: access.read.students && access.read.attendance ? absenceRisks : [],
    attendanceFreshness: access.read.attendance
      ? {
          referenceDate: attendance?.date ?? null,
          staleDays: attStaleDays,
          unavailable: briefingAttendanceUnavailable,
        }
      : null,
  });
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 콕핏에 prop 주입(하드코딩 금지).
  const subjects = subjectMaps;

  // 오늘 시작한 수업만 예정학생 대비 기록학생으로 판정한다. 한 명만 입력된 반을 완료로 보지 않는다.
  const startedClassIds = new Set(
    todaySchedule.filter((slot) => slot.status !== "upcoming").map((slot) => slot.classId),
  );
  const startedProcessing = attendanceState.todayProcessing.filter((row) =>
    startedClassIds.has(row.classId),
  );
  const startedExpected = startedProcessing.reduce((sum, row) => sum + row.expected, 0);
  const startedRecorded = startedProcessing.reduce(
    (sum, row) => sum + Math.min(row.recorded, row.expected),
    0,
  );
  const attendanceInProgress = startedExpected > 0 && startedRecorded < startedExpected;
  const unrecordedCount = startedProcessing.filter((row) => row.unprocessed > 0).length;
  const snapshotExpected = attendanceState.snapshotProcessing.reduce(
    (sum, row) => sum + row.expected,
    0,
  );
  const snapshotRecorded = attendanceState.snapshotProcessing.reduce(
    (sum, row) => sum + Math.min(row.recorded, row.expected),
    0,
  );
  const historicalSnapshotIncomplete =
    !!attendance &&
    attendance.date !== today &&
    snapshotExpected > 0 &&
    snapshotRecorded < snapshotExpected;
  const snapshotProcessingUnavailable = attendance
    ? attendance.date === today
      ? attendanceState.todayProcessingIssue
      : attendanceState.snapshotProcessingIssue
    : attendanceState.todayProcessingIssue;
  const snapshotSourceUnavailable =
    attendanceState.snapshotIssue || snapshotProcessingUnavailable;

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
  const attendanceRate =
    attendance &&
    attendance.total > 0 &&
    !attendanceStale &&
    !attendanceInProgress &&
    !historicalSnapshotIncomplete &&
    !snapshotSourceUnavailable
      ? attendance.rate
      : null;
  let attendanceAsOf: string | null = null;
  if (snapshotSourceUnavailable) {
    attendanceAsOf = "처리 현황 확인 불가";
  } else if (attendanceInProgress) {
    attendanceAsOf = `처리 중 ${startedRecorded}/${startedExpected}`;
  } else if (attendance && attendance.date !== today) {
    const md = `${Number(attendance.date.slice(5, 7))}/${Number(attendance.date.slice(8, 10))}`;
    if (attendanceStale) attendanceAsOf = `${md} 이후 기록 없음`;
    else if (historicalSnapshotIncomplete) {
      attendanceAsOf = `${md} 미완료 ${snapshotRecorded}/${snapshotExpected}`;
    } else attendanceAsOf = `${md} 기준`;
  } else if (!attendance) {
    attendanceAsOf = "기록 없음";
  }
  const paymentRate = payment && payment.totalCount > 0 ? payment.paymentRate : null;
  const unpaidCount = payment?.unpaidCount ?? 0;
  const quickActions: QuickActionKey[] = [];
  if (access.write.students) quickActions.push("student");
  if (access.write.classes) quickActions.push("class");
  if (access.write.consultations) quickActions.push("consultation");
  const showLiveSchedule = access.read.timetable || access.read.classes;
  const showFollowUps = access.read.consultations;
  const liveGrid =
    showLiveSchedule && showFollowUps
      ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]"
      : "grid-cols-1";

  return (
    <div className="space-y-5 pb-4">
      {/* ① EYWA 운영실 헤더 */}
      <CommandBand
        identity={{ name, honorific }}
        metrics={{
          enrollment: access.read.students
            ? {
                count: enrolled,
                delta: enrollmentDelta(
                  enrollmentChanges.newCount,
                  enrollmentChanges.withdrawnCount,
                ),
              }
            : null,
          attendance: access.read.attendance ? { rate: attendanceRate, asOf: attendanceAsOf } : null,
          billing: access.read.billing
            ? {
                paymentRate,
                unpaidCount,
                outstanding: payment?.outstanding ?? 0,
              }
            : null,
        }}
        enrollmentChanges={access.read.students ? enrollmentChanges : null}
        enrollmentChangesUnavailable={access.read.students && enrollmentChangesResult.unavailable}
      />

      {/* ①.5 일일 AI 브리핑 — cron 사전 생성분 표시 + 명시 '다시 생성'(master/admin/manager 전용) */}
      {canSeeDailyBriefing ? <DailyBriefingCard briefing={dailyBriefingResult.data} links={briefingLinks} /> : null}

      {/* ①.6 매니저 팀에게 물어보기 — 대화형 비서(질문 1건 = 명시 트리거 1회, Phase 2) */}
      {canUseAssistant ? (
        <AssistantPanel
          initialConversationId={assistantConversationResult.data?.id ?? null}
          initialTurns={assistantConversationResult.data?.turns ?? []}
        />
      ) : null}

      {/* ② 오늘 브리핑 — 조회·정리만, 실행은 원본 화면에서 */}
      <OperationsBriefing briefing={briefing} />

      {/* 빠른 작업 */}
      <QuickActions allowed={quickActions} />

      {showLiveSchedule || showFollowUps ? (
        <section aria-labelledby="live-operations-title" className="space-y-3">
          <header className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div>
              <p className="text-primary text-[12px] font-bold">
                실시간 운영
              </p>
              <h2 id="live-operations-title" className="text-foreground mt-0.5 text-[17px] font-bold tracking-tight">
                지금 진행 중
              </h2>
            </div>
            <p className="text-text-dim text-[12px]">수업 흐름과 사람 후속조치를 한곳에서 봅니다.</p>
          </header>
          <div className={`grid items-start gap-4 ${liveGrid}`}>
            {showLiveSchedule ? (
              <NowCockpit
                slots={todaySchedule}
                subjects={subjects}
                unrecordedCount={unrecordedCount}
                attendanceProcessingUnavailable={
                  access.read.attendance && attendanceState.todayProcessingIssue
                }
                canOpenClasses={access.read.classes}
                canOpenTimetable={access.read.timetable}
              />
            ) : null}
            {showFollowUps ? (
              <FollowUpCard
                items={followUps}
                canOpenStudents={access.read.students}
                unavailable={followUpsResult.unavailable}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 학원 펄스 — 판단 큐 다음의 보조 맥락. */}
      <SlimTrend
        data={trend}
        change={enrollmentChange}
        subjects={subjects}
        visible={{
          attendance: access.read.attendance,
          billing: access.read.billing,
          enrollment: access.read.students,
        }}
      />

      {/* 카드 안의 카드 — 학원 펄스와 같은 결(원장 2026-08-31: *"카드 안에 단 구분 시키던지해서 깔끔해지게"*).
          세 장이 따로 떠 있으면 내용이 짧은 쪽(공지)이 위로 붙어 아래가 휑했다. 하나로 감싸고
          안쪽은 패널로 낮춰(그림자 없는 rounded-xl) 높이를 맞춘다 — 빈 패널도 같은 높이로 늘어난다. */}
      <section
        aria-labelledby="operations-context-title"
        className="bg-card border-line shadow-card rounded-2xl border px-5 py-4"
      >
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-text-dim text-[12px] font-bold">
              참고 지표
            </p>
            <h2 id="operations-context-title" className="text-foreground mt-0.5 text-[17px] font-bold tracking-tight">
              운영 맥락
            </h2>
          </div>
          <p className="text-text-dim text-[12px]">결정 뒤에 참고할 수납·등록·팀 공지입니다.</p>
        </header>
        {/* 안쪽 패널: 그림자를 빼고 모서리를 한 단 낮춘다(바깥 카드가 이미 떠 있으므로 두 번 띄우지 않는다).
            높이는 grid 기본(stretch)에 맡긴다 — `items-start`를 두면 짧은 패널이 위로 붙는다. */}
        <div
          className="grid gap-4 [&>section]:rounded-xl [&>section]:shadow-none"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 19rem), 1fr))" }}
        >
          {access.read.billing ? (
            <OutstandingCard items={outstanding} canOpenStudents={access.read.students} />
          ) : null}
          {access.read.enrollment ? (
            <EnrollmentListCard list={enrollList} unavailable={enrollListResult.unavailable} />
          ) : null}
          <AnnouncementsCard
            items={announcements}
            canManage={canManageAnnouncements}
            manageItems={manageAnnouncements}
            unavailable={recentAnnouncementsResult.unavailable}
            manageUnavailable={manageAnnouncementsResult.unavailable}
          />
        </div>
      </section>
    </div>
  );
}
