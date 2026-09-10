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
import { buildTodayActions } from "@/features/dashboard/today-actions";
import { buildOperationsBriefing } from "@/features/dashboard/operations-briefing";
import { resolveDashboardAccess, todayActionGate } from "@/features/dashboard/dashboard-access";
import { buildBriefingLinks } from "@/features/dashboard/briefing-links";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { enrollmentDelta } from "@/features/dashboard/metrics";
import { CommandBand } from "../_components/command-band";
import { OperationsBriefing } from "../_components/operations-briefing";
import { DailyBriefingCard, dailyBriefingSummary } from "../_components/daily-briefing-card";
import { SecondarySection } from "../_components/secondary-section";
import { OutstandingCard } from "../_components/outstanding-card";
import { EnrollmentListCard } from "../_components/enrollment-list-card";
import { FollowUpCard } from "../_components/followup-card";
import { AnnouncementsCard } from "../_components/announcements-card";
import { SlimTrend, hasTrendContent } from "../_components/slim-trend";

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

export const metadata = { title: "일일 브리핑 — eywa" };
// 일일 브리핑 '다시 생성'(regenerateDailyBriefing) 서버 액션이 이 라우트로 POST되고 after()로
// 백그라운드 AI 호출을 이어간다 — 응답 종료 뒤 작업이 잘리지 않게 여유를 둔다.
export const maxDuration = 60;

export default async function BriefingPage() {
  const user = await requireAccess("dashboard");
  const permissionMatrix = await getPermMatrix();
  const access = resolveDashboardAccess(user.systemRole, permissionMatrix);
  const canManageAnnouncements =
    canManageStaff(user.systemRole) && canWrite(user.systemRole, "dashboard", permissionMatrix);
  // 일일 브리핑은 master/admin/manager 전용 — payload가 master 관점 전신호(미수·결재 포함)라
  // scoped 역할(counselor/accountant)에는 카드 자체를 렌더하지 않는다(#77, 0114a 주석 참조).
  const canSeeDailyBriefing = canManageStaff(user.systemRole);
  const [
    enrolledResult,
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
    enrollmentChangeResult,
    dailyBriefingResult,
  ] = await Promise.all([
    // 실패 허용 래퍼 — 쿼리는 throw하고(위장 금지) 카드는 fallback으로 그리되 실패가 로그에 남는다.
    access.read.students
      ? dashboardQuery("enrolled student count", getEnrolledStudentCount(), 0)
      : Promise.resolve({ data: 0, unavailable: false }),
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
      ? // ⚠️ 캐시본(60초)은 admin 클라이언트라 RLS를 안 탄다 — **이 줄의 권한 분기가 곧 게이트다**.
        getTrendDataLast7Days(user.tenantId, {
          attendance: access.read.attendance,
          billing: access.read.billing,
        })
      : Promise.resolve([]),
    // 오늘 시간표는 이제 출결 '처리 중 N/M' 판정(startedClassIds)에만 쓰인다 —
    // 출결 열람 권한이 없으면 그 계산 자체가 빈 값이라 조회하지 않는다(죽은 쿼리 금지).
    access.read.attendance ? getTodaySchedule() : Promise.resolve([]),
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
      timetable: access.read.timetable,
    }),
    access.read.students
      ? dashboardQuery("enrollment change 7d", getEnrollmentChangeLast7d(), EMPTY_ENROLLMENT_CHANGE)
      : Promise.resolve({ data: EMPTY_ENROLLMENT_CHANGE, unavailable: false }),
    // 저장분 조회만(AI 호출 없음). 테이블 미적용 DB에서도 대시보드가 죽지 않게 실패 허용 래퍼.
    canSeeDailyBriefing
      ? dashboardQuery<DailyBriefingRow | null>("daily briefing", getDailyBriefing(user.tenantId, kstToday()), null)
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
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 학원생 증감 카드에 prop 주입(하드코딩 금지).
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
  // '빠른 작업'·'실시간 운영'·'대화형 비서'는 뺐다 — 지시서 §10 "같은 동작을 두 곳에 두지 말 것": 각 화면의
  // Primary가 이미 그 일이다(학생목록 '새 학생' 등). 원장 2026-09-03 "지시서 그대로".
  const showFollowUps = access.read.consultations;
  const trendVisible = {
    attendance: access.read.attendance,
    billing: access.read.billing,
    enrollment: access.read.students,
  };

  return (
    <div className="space-y-5 pb-4">
      {/* ① EYWA 운영실 헤더 */}
      <CommandBand
        identity={{ name, honorific }}
        metrics={{
          enrollment: access.read.students
            ? {
                count: enrolledResult.data,
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

      {/* ② 오늘 브리핑 — 조회·정리만, 실행은 원본 화면에서 */}
      <OperationsBriefing briefing={briefing} />

      {/* 1차 화면의 시선 앵커는 셋뿐이다(지시서 §4 "시선 앵커 3개 이하", 원장 2026-09-03 "지시서 그대로") —
            ① 인사·지표 ② 오늘 브리핑 ③ 후속조치. 나머지(매니저 팀 보고·학원생 증감·운영 맥락)는 접힌
          2차 구역(`SecondarySection`)으로 내렸다. 접힌 줄이 오늘 보고의 **제목**을 나르므로 1차에서도 "보고가
          있다·무슨 내용인지"는 읽힌다.
          ⚠️ **대화형 비서·실시간 운영(오늘 일정)·빠른 작업은 화면에서 뺐다**(원장 2026-09-03 지목) — 되살리려면
             부품부터 다시 만들어야 한다(파일도 함께 지워졌다). */}
      {canSeeDailyBriefing ? (
        <SecondarySection
          id="daily-briefing"
          label="매니저 팀 보고"
          hint={(() => {
            // 조회 실패는 "보고 없음"과 다른 사실 — 접힌 줄 한 줄이 1차에서 보이는 전부라 여기서 갈라 적는다.
            const s = dailyBriefingSummary(dailyBriefingResult.data, dailyBriefingResult.unavailable);
            return s.tone === "danger" ? <span className="text-danger font-bold">{s.text}</span> : s.text;
          })()}
        >
          <DailyBriefingCard briefing={dailyBriefingResult.data} links={briefingLinks} unavailable={dailyBriefingResult.unavailable} />
        </SecondarySection>
      ) : null}

      {/* 상담 후속조치 — 원장 지시(2026-09-03)로 '실시간 운영/지금 진행 중' 묶음은 걷어냈지만,
          이 카드는 그 안에 얹혀 있었을 뿐 다른 신호라 그대로 남긴다(오늘 브리핑의 후속조치 신호와 같은 소스). */}
      {showFollowUps ? (
        <FollowUpCard
          items={followUps}
          canOpenStudents={access.read.students}
          unavailable={followUpsResult.unavailable}
        />
      ) : null}

      {/* 2차 — 최근 7일 추세(학생 증감·출석·수납). 그릴 것이 없으면 줄 자체를 안 세운다(빈 구역 금지). */}
      {hasTrendContent(trend, enrollmentChangeResult.data, trendVisible) ? (
        <SecondarySection id="trend" label="학원생 증감" hint={`최근 ${enrollmentChangeResult.data.days}일`}>
          <SlimTrend data={trend} change={enrollmentChangeResult.data} subjects={subjects} visible={trendVisible} />
        </SecondarySection>
      ) : null}

      {/* 2차 — 운영 맥락(누적 미수·등록상담·공지). 세 장을 **카드로 다시 싸지 않는다**(지시서 §4 "카드 안의 카드 금지").
          짧은 쪽(공지)이 위로 붙어 아래가 휑하던 문제는 grid 기본(stretch)이 그대로 막는다(`items-start`를 두지 말 것).
          ⚠️ 접힌 줄의 요약에 미수·공지 **건수를 적지 않는다** — 두 목록은 상위 N으로 잘린 미리보기라 길이가 곧 건수가
          아니다([[#89]]). 등록상담만 쿼리가 세어 준 총건수다. */}
      <SecondarySection
        id="context"
        label="운영 맥락"
        hint={[
          access.read.billing ? "누적 미수" : null,
          // 조회 실패면 건수 대신 실패를 적는다(카드는 그대로 서 있으니 요약에서 지우면 카드와 어긋난다).
          access.read.enrollment
            ? enrollListResult.unavailable
              ? "등록상담(불러오지 못함)"
              : `등록상담 최근 30일 ${enrollList.total}건`
            : null,
          "공지",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <div
          className="grid gap-4"
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
      </SecondarySection>
    </div>
  );
}
