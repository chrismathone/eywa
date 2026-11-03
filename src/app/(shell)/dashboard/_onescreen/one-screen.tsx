import { canManageStaff } from "@/lib/auth/role-hierarchy";
import type { AccessMatrix, SystemRole } from "@/lib/permissions";
import { kstToday } from "@/lib/date-kst";
import {
  buildDashboardPlan,
  planIncludes,
  type DashboardAreas,
} from "@/features/dashboard/onescreen/layout-plan";
import { resolveDashboardAccess, todayActionGate } from "@/features/dashboard/dashboard-access";
import {
  attendanceTone,
  closedAttendanceRate,
  todayAttendanceKpi,
} from "@/features/dashboard/onescreen/kpi";
import { LOW_HOMEWORK_RATE } from "@/features/dashboard/onescreen/homework-risk";
import { buildWatchlist, watchlistOverflow } from "@/features/dashboard/onescreen/watchlist";
import { buildCareCells } from "@/features/newcomers/care-cells";
import { getNewcomers } from "@/features/newcomers/server/queries";
import { buildTodayActions } from "@/features/dashboard/today-actions";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { getTodayActionSignals } from "@/features/dashboard/server/action-signals";
import { getDailyBriefing, type DailyBriefingRow } from "@/features/dashboard/server/briefing";
import { DAILY_BRIEFING_ENABLED } from "@/features/dashboard/briefing-status";
import {
  getAbsenceRiskCached,
  getDashboardAttendanceState,
  getEnrolledStudentCount,
  getFollowUpConsultations,
  getMonthlyEnrollmentChanges,
  getPaymentRateThisMonth,
  getTopOutstandingCached,
  getTrendDataLast7Days,
} from "@/features/dashboard/server/queries";
import {
  getHomeworkRisk,
  getUnreadReports,
  getWeeklyChange,
} from "@/features/dashboard/onescreen/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { paymentRateDisplay, unpaidBreakdown } from "@/features/billing/calc";
import {
  attendanceBar,
  attendanceBarTitle,
  paymentBar,
  paymentBarTitle,
} from "@/features/dashboard/onescreen/tile-bar";
import { formatWon } from "@/features/billing/textbook-notice";
import { AttendanceTrend, CompositionBars, WeeklyChangeBars } from "./charts";
import { countByLabel, toCompositionBars } from "@/features/dashboard/onescreen/composition";
import { getGradeComposition } from "@/features/dashboard/server/queries";
import { Cell, OneScreenGrid } from "./grid";
import {
  CareCells,
  OutstandingList,
  RiskRows,
  TodoList,
  Watchlist,
  type RiskRow,
} from "./panels";
import { SKINS, type OneScreenSkin } from "./skin";
import { KpiTile, Panel, PanelEmpty, StripPanel } from "./tiles";

/**
 * **한 화면 대시보드** — 스크롤 없이 한 화면(원장 2026-09-09), 나중에 열린 창이 없을 때 바탕에 선다.
 *
 * 순서가 이 파일의 전부다: **권한 → 격자 계획 → 그 계획이 요구하는 조회만 → 렌더.**
 * 🔴 "조회해 놓고 감추기"를 하지 않는다([[#77]]) — 꺼진 칸의 쿼리는 아예 만들지 않는다.
 * 🔴 조회 실패를 **빈 값(0건·0%)으로 위장하지 않는다** — 실패는 `null`로 내려가고 칸이 그 사실을 적는다
 *    (0건·조회 실패·권한 없음 셋을 같은 초록으로 그리면 아무도 전화를 안 한다).
 */

/** 실패 허용 래퍼 — 쿼리는 throw하고(위장 금지) 칸은 null로 그리되 실패가 로그에 남는다. */
async function soft<T>(label: string, q: Promise<T>): Promise<T | null> {
  try {
    return await q;
  } catch (error) {
    console.error(`[dashboard/onescreen] ${label} 실패`, error);
    return null;
  }
}
const skip = Promise.resolve(null);

export async function OneScreenDashboard({
  systemRole,
  permMatrix,
  tenantId,
  skin = "a",
}: {
  systemRole: SystemRole;
  permMatrix: AccessMatrix;
  tenantId: string;
  /** 껍데기 비교안(원장 2026-09-10 *"두가지다 볼 수 있게"*) — 데이터·판정은 한 벌이다. */
  skin?: OneScreenSkin;
}) {
  const sk = SKINS[skin];
  const access = resolveDashboardAccess(systemRole, permMatrix);
  // 브리핑은 payload가 master 관점 전신호(0114a)라 scoped 역할엔 통짜 서술이 새어 나간다 — 계속 제한한다.
  const canSeeBriefing = DAILY_BRIEFING_ENABLED && canManageStaff(systemRole);
  const areas: DashboardAreas = {
    attendance: access.read.attendance,
    billing: access.read.billing,
    students: access.read.students,
    consultations: access.read.consultations,
    staff: access.read.staff,
    briefing: canSeeBriefing,
    newcomers: access.read.newcomers,
    retention: access.read.retention,
    lessonReports: access.read.lessonReports,
  };
  const plan = buildDashboardPlan(areas);
  // ClassNote 기능(모듈) — 꺼진 학원엔 '학부모 미확인'(ClassNote 읽음 기록) 칸이 없다. 설정은 요청 캐시라 아래 배치와 공유.
  const classnoteOn = classnoteModuleOn(await getTenantSettings());
  if (plan.empty) {
    return (
      <p className="text-text-dim border-line rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
        표시할 수 있는 항목이 없습니다 — 메뉴 권한을 확인해 주세요.
      </p>
    );
  }

  const today = kstToday();
  const need = (k: Parameters<typeof planIncludes>[1]) => planIncludes(plan, k);

  const [
    enrolled,
    changes,
    attState,
    schedule,
    payment,
    signals,
    settings,
    risks,
    followUps,
    briefing,
    outstanding,
    trend,
    weekly,
    grades,
    newcomers,
    homework,
    unread,
  ] = await Promise.all([
    need("students") ? soft("재원생 수", getEnrolledStudentCount()) : skip,
    need("students") ? soft("이번 달 증감", getMonthlyEnrollmentChanges()) : skip,
    need("attendance") ? soft("오늘 출결", getDashboardAttendanceState()) : skip,
    // 오늘 시간표는 "이미 시작한 반"을 가르는 데만 쓴다 — 출결을 못 보면 그 계산 자체가 빈 값이다.
    need("attendance") ? soft("오늘 시간표", getTodaySchedule()) : skip,
    need("billing") ? soft("이번 달 수납", getPaymentRateThisMonth()) : skip,
    need("todo")
      ? soft(
          "오늘 할 일 신호",
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
            // 🔴 이 화면에선 끈다 — '신규생 케어' 칸이 같은 사실을 항목별로 더 자세히 말하므로
            //    '오늘 할 일'에 "신규생 관리 지연 N명"을 또 세우면 한 화면이 같은 값을 두 번 적는다(§2).
            //    권한이 없는 사람에겐 그 항목이 어차피 걸러졌으니 조회 셋(학생·수강·체크)만 줄어든다.
            newcomers: false,
          }),
        )
      : skip,
    // 위험 줄의 과목 축(수업보고서를 쓰는 과목)도 이 설정에서 온다 — 라벨을 하드코딩하지 않는다.
    need("todo") || need("risk") ? soft("학원 설정", getTenantSettings()) : skip,
    // ⚠️ 캐시본은 admin 클라이언트라 RLS를 안 탄다 — **이 줄의 권한 분기가 곧 게이트다**(queries.ts 주석).
    (need("watchlist") || need("risk")) && access.read.attendance
      ? soft("결석 위험", getAbsenceRiskCached(tenantId))
      : skip,
    need("watchlist") && access.read.consultations ? soft("상담 후속", getFollowUpConsultations(8)) : skip,
    // 🔴 브리핑 **패널은 없앴지만 조회는 남는다** — 위험 줄의 `퇴원위험`이 이 payload의
    //    `spotlights`에서 오기 때문이다(0114a). 게이트를 그 칸으로 옮긴다.
    canSeeBriefing && need("risk") ? soft("일일 브리핑", getDailyBriefing(tenantId, today)) : skip,
    // 공지는 브리핑 패널이 유일한 소비처였다 — 패널이 없어졌으니 조회도 없앤다(왕복 −1, 이 자리는 비운다).
    need("outstanding") ? soft("미납 상위", getTopOutstandingCached(tenantId)) : skip,
    need("attendance7d")
      ? soft("7일 추세", getTrendDataLast7Days(tenantId, { attendance: true, billing: false }))
      : skip,
    need("enroll4w") ? soft("4주 증감", getWeeklyChange()) : skip,
    // 학년 구성 — grade 한 칸만 받는다(payload 최소). 재원생 339명이라 한 장이지만 페이지네이션은 지킨다.
    need("grades") ? soft("학년 구성", getGradeComposition()) : skip,
    // 신규생 조회는 **신규생 탭과 같은 함수**다(판정·창이 갈리지 않게). 위 `newcomers: false`로 같은
    // 재료를 두 번 긁지 않는다.
    need("care") ? soft("신규생", getNewcomers()) : skip,
    // 🔴 두 조회는 과목 축(학원설정)을 **자기 안에서** 읽는다 — 밖에서 설정을 기다렸다가 넘기면
    //    이 배치가 둘로 갈려 직렬 워터폴이 된다(B4). `getTenantSettings`는 요청 캐시라 왕복이 안 는다.
    need("risk") && access.read.lessonReports ? soft("숙제 위험", getHomeworkRisk()) : skip,
    need("risk") && access.read.lessonReports && classnoteOn ? soft("학부모 미확인", getUnreadReports()) : skip,
  ]);

  // ── 오늘 출결 ────────────────────────────────────────────────────────────────
  const startedIds = new Set((schedule ?? []).filter((s) => s.status !== "upcoming").map((s) => s.classId));
  const att = todayAttendanceKpi({ processing: attState?.todayProcessing ?? [], startedClassIds: startedIds });
  const attRate = closedAttendanceRate(att, attState?.snapshot ?? null, today);
  /**
   * 🔴 **시간표 조회 실패도 '실패'다.** 시간표가 없으면 `startedClassIds`가 비어 판정이 `none`이 되고,
   *    타일이 *"오늘 시작한 수업 없음"* 라고 **거짓을 말한다**(수업은 돌고 있는데 화면만 조용하다).
   *    이 화면이 가장 조심해야 하는 실패 모드라, 세 조회 중 하나라도 못 받으면 숫자를 안 적는다.
   */
  const attFailed = attState === null || attState.todayProcessingIssue || schedule === null;

  // ── 오늘 할 일 ──────────────────────────────────────────────────────────────
  const subjectLabel = settings ? buildSubjectMaps(settings.operations.subjects).labelOf : undefined;
  const canOpen = todayActionGate(systemRole, permMatrix, access);
  const todos = signals
    ? buildTodayActions(signals, subjectLabel ? { subjectLabel } : undefined).filter((i) =>
        canOpen(i.menuKey, i.requiredAccess),
      )
    : [];

  // ── 확인이 필요한 학생 ─────────────────────────────────────────────────────
  /**
   * 🔴 본문 칸은 **안쪽 스크롤이 없어 넘치면 말없이 잘린다** — 그러면 "외 N명"이 거짓이 된다
   *    (화면엔 6줄인데 8줄을 세운 셈). 신규생·위험 띠가 세로를 112px 가져갔으므로 줄 수를 그만큼 줄인다.
   * ⚠️ 목록과 "외 N"이 **같은 상한**을 봐야 한다 — 한쪽만 고치면 그 수가 어긋난다.
   */
  const WATCH_MAX = 6;
  const TODO_MAX = 8;
  const watch = buildWatchlist(risks ?? [], followUps ?? [], WATCH_MAX);
  const watchMore = watchlistOverflow(risks ?? [], followUps ?? [], WATCH_MAX);

  // 🔴 조회 실패(`briefing === null`)를 "오늘 보고 없음"으로 위장하지 않는다 — 그 헬퍼가
  //    `unavailable` 인자로 그 구분을 이미 들고 있다([[#95]] 계열: 표 미적용도 여기로 떨어진다).
  const briefingRow = briefing as DailyBriefingRow | null;

  // ── 신규생 관리 ─────────────────────────────────────────────────────────────
  /**
   * 🔴 **체크를 못 읽으면 숫자를 적지 않는다.** 0251a 미적용이면 체크가 통째로 비어 모든 항목이
   *    '지연'으로 잡히는데(아무도 기록할 수 없었으니 당연하다) 그 숫자를 크게 적으면 **없는 사실**이 된다.
   *    실패·미적용·0건은 서로 다른 말로 적는다.
   */
  const careUsable = newcomers !== null && newcomers.checksAvailable;
  const careCells = careUsable ? buildCareCells(newcomers.rows, newcomers.today) : [];
  const careNote =
    newcomers === null
      ? "불러오지 못했습니다"
      : newcomers.checksAvailable
        ? `대상 ${newcomers.rows.length}명`
        : (newcomers.checksError?.summary ?? "체크 기록이 아직 켜지지 않았습니다");

  // ── 학생 관리 현황 ─────────────────────────────────────────────────────────
  // 🔴 **재료가 있는 축만** 세운다 — 수업태도는 93% 채워져 있어도 하향 등급이 0건이라(실측 2026-09-10)
  //    "태도 주의 0명"이 영원히 서고 그 0은 "문제 없음"으로 읽힌다. 학부모 만족도는 구조화 기록이 없다.
  // 🔴 수납은 넣지 않는다 — 같은 화면의 수납 타일이 이미 미납 건수를 말한다(§2 같은 값 두 번 금지).
  const churnTop = (briefingRow?.payload?.spotlights ?? []).find((s) => s.action);
  /**
   * 숙제·학부모 확인의 재료(`lesson_reports`)는 **aywa에 보고서를 쓰는 과목만**이다 — 현 운영상 수학이고
   * 영어는 ClassNote에 직접 쓴다(영어 0건). 🔴 그래서 라벨에 과목 축이 보여야 한다 — 안 그러면 원장이
   * 학원 전체로 읽는다. 축은 학원설정에서 오고 라벨은 `buildSubjectMaps`(운영 enum 단일 소스)가 만든다.
   */
  const reportSubjects = homework?.subjects ?? unread?.subjects ?? [];
  const reportScope =
    reportSubjects.length > 0 && subjectLabel ? reportSubjects.map((k) => subjectLabel(k)).join("·") : null;
  const scoped = (text: string) => (reportScope ? `${reportScope} · ${text}` : text);

  const riskRows: RiskRow[] = [];
  if (areas.attendance) {
    riskRows.push({
      key: "attendance",
      label: "결석",
      value: risks === null ? null : String(risks.length),
      unit: "명",
      // #121 — 임계값의 **이름**이 아니라 그 기준이 만든 실제 조건을 적는다.
      reason: risks === null ? "불러오지 못했습니다" : "최근 14일 3회 이상",
      tone: risks === null ? "inert" : risks.length > 0 ? "caution" : "inert",
      href: "/attendance",
      title: "최근 14일 결석 3회 이상인 학생 수",
    });
  }
  if (areas.lessonReports) {
    riskRows.push({
      key: "homework",
      label: "숙제",
      value: homework === null ? null : String(homework.students),
      unit: "명",
      reason:
        homework === null
          ? "불러오지 못했습니다"
          : scoped(`최근 ${homework.windowDays}일 ${LOW_HOMEWORK_RATE}% 미만`),
      tone: homework === null ? "inert" : homework.students > 0 ? "caution" : "inert",
      href: "/lesson-reports?tab=list",
      // 🔴 `미제출`(안 내옴)과 `0%`(했는데 못 함)는 다른 사실이라 뭉치지 않고 갈라 적는다.
      //    판정 불가(`없음`·`일부 미흡`)는 분모에서 빠졌다는 사실도 함께 밝힌다.
      title:
        homework === null
          ? undefined
          : `미제출 ${homework.notSubmitted}명 · 0% ${homework.zero}명 · 판정한 기록 ${homework.parsed}건(판정 불가 ${homework.unparsed}건 제외)`,
    });
    // 학부모 미확인 = ClassNote 읽음이 소스 — ClassNote 기능이 꺼진 학원엔 이 줄이 없다(2026-09-30).
    if (classnoteOn) riskRows.push({
      key: "unread",
      label: "학부모",
      value: unread === null ? null : String(unread.reports),
      // ⚠️ 단위가 '명'이 아니다 — 한 학생이 여러 건일 수 있어 합치면 거짓이 된다.
      unit: "건",
      reason:
        unread === null ? "불러오지 못했습니다" : scoped(`${unread.graceHours}시간 지나도 미확인`),
      tone: unread === null ? "inert" : unread.reports > 0 ? "caution" : "inert",
      href: "/lesson-reports?tab=list",
      title:
        unread === null
          ? undefined
          : `발송 성공 · 최근 ${unread.windowDays}일 · 발송 후 ${unread.graceHours}시간이 지나도 학부모가 열지 않은 보고서(동기화 대상만)`,
    });
  }
  if (areas.retention && areas.briefing) {
    const churn = briefingRow?.payload?.retention?.risk ?? null;
    riskRows.push({
      key: "churn",
      label: "퇴원위험",
      value: churn === null ? null : String(churn),
      unit: "명",
      // 🔴 사유·권장 조치는 retention이 만든 문장 그대로(여기서 다시 쓰지 않는다).
      reason:
        churn === null
          ? briefing === null
            ? "브리핑을 불러오지 못했습니다"
            : "집계 없음"
          : churn > 0
            ? (churnTop?.reasons[0] ?? "오늘 브리핑 기준")
            : "오늘 브리핑 기준",
      tone: churn === null ? "inert" : churn > 0 ? "critical" : "inert",
      href: "/retention",
      title:
        churn && churn > 0 && churnTop?.action
          ? `${churnTop.name} — ${churnTop.action}`
          : "오늘 브리핑이 센 이탈 위험 학생 수",
    });
  }

  const kpiOf = (key: string) => plan.kpis.find((c) => c.key === key)?.span ?? 0;
  const careOf = (key: string) => plan.care.find((c) => c.key === key)?.span ?? 0;
  const bodyOf = (key: string) => plan.body.find((c) => c.key === key)?.span ?? 0;
  const chartOf = (key: string) => plan.charts.find((c) => c.key === key)?.span ?? 0;

  return (
    <OneScreenGrid
      gap={sk.gridGap}
      kpis={
        <>
          {kpiOf("students") > 0 ? (
            <Cell span={kpiOf("students")}>
              <KpiTile
                sk={sk}
                label="재원생"
                shortLabel="재원"
                value={enrolled === null ? null : enrolled.toLocaleString("ko-KR")}
                unit="명"
                href="/students"
                tone={enrolled === null ? "inert" : "positive"}
                sub={
                  changes === null ? (
                    <span className="text-text-faint">이번 달 증감을 불러오지 못했습니다</span>
                  ) : (
                    <>
                      {/* 🔴 무엇의 증감인지 적는다(원장 2026-09-10 *"+1, -6 보다. 신규원생 +1, 퇴원생 -6"*) —
                          부호만으로는 무엇이 늘고 줄었는지 읽는 사람이 되짚어야 한다. */}
                      신규 <span className="num text-green font-bold">+{changes.newCount}</span>
                      {/* 퇴원은 수업료를 낸 마지막 달로 센다(원장 2026-10-29) — 기준을 적지 않으면 월초 '퇴원 -0'이 오류처럼 읽힌다(원장 2026-11-03). */}
                      {" · 퇴원(수업료 기준) "}
                      <span className="num text-amber font-bold">-{changes.withdrawnCount}</span>
                    </>
                  )
                }
              />
            </Cell>
          ) : null}

          {kpiOf("attendance") > 0 ? (
            <Cell span={kpiOf("attendance")}>
              <KpiTile
                sk={sk}
                label={att.mode === "closed" ? "오늘 출석률" : "출결 미기록"}
                shortLabel={att.mode === "closed" ? "출석률" : "미기록"}
                // 🔴 진행 중엔 %가 아니라 **미기록 반 수**다(§2) — 40/121반의 98%는 거짓 안심이다.
                value={
                  attFailed
                    ? null
                    : att.mode === "closed"
                      ? attRate === null
                        ? null
                        : String(Math.round(attRate))
                      : att.mode === "none"
                        ? null
                        : String(att.unmarkedClasses)
                }
                unit={att.mode === "closed" ? "%" : "개 반"}
                href="/attendance/live"
                tone={attFailed ? "inert" : attendanceTone(att)}
                sub={
                  attFailed
                    ? "출결을 불러오지 못했습니다"
                    : att.mode === "none"
                      ? "오늘 시작한 수업 없음"
                      : `시작 ${att.startedClasses}곳 중 ${att.unmarkedClasses}곳이 아직 0명 · 찍힌 인원 ${att.recorded}/${att.expected}`
                }
                // 🔴 막대는 **반 단위**다(주숫자와 같은 축) — 학생 수를 그리면 수업 중인 반이 분모에 들어가
                //    아침부터 빨갛다. 조회 실패·오늘 수업 없음이면 빈 배열이라 막대가 아예 안 선다.
                bar={
                  attFailed || att.mode === "none"
                    ? undefined
                    : attendanceBar({
                        startedClasses: att.startedClasses,
                        unmarkedClasses: att.unmarkedClasses,
                      })
                }
                barTitle={
                  attFailed || att.mode === "none"
                    ? undefined
                    : attendanceBarTitle({
                        startedClasses: att.startedClasses,
                        unmarkedClasses: att.unmarkedClasses,
                      })
                }
              />
            </Cell>
          ) : null}

          {kpiOf("billing") > 0 ? (
            <Cell span={kpiOf("billing")}>
              <KpiTile
                sk={sk}
                label="이번 달 수납"
                shortLabel="수납"
                // 🔴 미수가 남아 있으면 100%로 적지 않는다 — 표기 규칙은 billing/calc 단일 소스.
                value={payment === null ? null : paymentRateDisplay(payment.paymentRate, payment.outstanding)}
                unit="%"
                href="/billing"
                tone={payment === null ? "inert" : payment.outstanding > 0 ? "caution" : "positive"}
                sub={
                  payment === null
                    ? "수납을 불러오지 못했습니다"
                    : `금액 기준 · 미수 ${formatWon(payment.outstanding)}원 · ${unpaidBreakdown(payment)}`
                }
                // ⚠️ 주숫자(수납률)는 **금액 기준**인데 이 막대는 **건수 축**이다 — 그래서 부제가
                //    "금액 기준"이라고 먼저 말하고, 막대 설명이 "건수 기준"이라고 다시 말한다.
                //    둘 중 하나라도 라벨을 지우면 그 순간 화면이 거짓말을 시작한다.
                bar={payment === null ? undefined : paymentBar(payment)}
                barTitle={payment === null ? undefined : paymentBarTitle(payment)}
              />
            </Cell>
          ) : null}

        </>
      }
      care={
        plan.care.length === 0 ? null : (
          <>
            {careOf("care") > 0 ? (
              <Cell span={careOf("care")}>
                <StripPanel sk={sk} title="신규생 관리" note={careNote} href="/newcomers">
                  {careUsable ? (
                    <CareCells cells={careCells} />
                  ) : (
                    <PanelEmpty>
                      {newcomers === null
                        ? "신규생을 불러오지 못했습니다"
                        : (newcomers.checksError?.summary ??
                          "체크 기록이 아직 켜지지 않았습니다 — 기록이 열리면 숫자가 채워집니다")}
                    </PanelEmpty>
                  )}
                </StripPanel>
              </Cell>
            ) : null}


            {careOf("risk") > 0 ? (
              <Cell span={careOf("risk")}>
                <StripPanel sk={sk} title="학생 관리 현황">
                  <RiskRows rows={riskRows} />
                </StripPanel>
              </Cell>
            ) : null}
          </>
        )
      }
      body={
        <>
          {bodyOf("todo") > 0 ? (
            <Cell span={bodyOf("todo")}>
              <Panel sk={sk} title="오늘 할 일" count={signals === null ? undefined : `${todos.length}가지`}>
                {signals === null ? (
                  <PanelEmpty>신호를 불러오지 못했습니다</PanelEmpty>
                ) : (
                  <TodoList items={todos} max={TODO_MAX} />
                )}
              </Panel>
            </Cell>
          ) : null}

          {bodyOf("watchlist") > 0 ? (
            <Cell span={bodyOf("watchlist")}>
              <Panel sk={sk} title="확인이 필요한 학생" count={watch.length > 0 ? `${watch.length + watchMore}명` : undefined}>
                {risks === null && followUps === null ? (
                  <PanelEmpty>명단을 불러오지 못했습니다</PanelEmpty>
                ) : (
                  <Watchlist items={watch} overflow={watchMore} />
                )}
              </Panel>
            </Cell>
          ) : null}


          {bodyOf("outstanding") > 0 ? (
            <Cell span={bodyOf("outstanding")}>
              <Panel sk={sk} title="미납 상위" href="/billing">
                {outstanding === null ? (
                  <PanelEmpty>미납을 불러오지 못했습니다</PanelEmpty>
                ) : (
                  <OutstandingList
                    rows={outstanding.map((o) => ({
                      studentId: o.studentId,
                      studentName: o.studentName,
                      amount: Number(o.amount) || 0,
                    }))}
                  />
                )}
              </Panel>
            </Cell>
          ) : null}
        </>
      }
      charts={
        plan.charts.length === 0 ? null : (
          <>
            {chartOf("attendance7d") > 0 ? (
              <Cell span={chartOf("attendance7d")}>
                <Panel sk={sk} title="최근 7일 출석률">
                  {trend === null ? (
                    <PanelEmpty>추세를 불러오지 못했습니다</PanelEmpty>
                  ) : (
                    <AttendanceTrend
                      points={trend.map((p) => ({
                        day: p.day,
                        // 🔴 오늘이 아직 마감 전이면 마지막 점을 그리지 않는다 — 진행 중 비율은 위로 튀고
                        //    그 튐이 "오늘 좋아졌다"는 거짓 신호가 된다.
                        attendance: p.date === today && att.mode !== "closed" ? null : p.attendance,
                      }))}
                    />
                  )}
                </Panel>
              </Cell>
            ) : null}

            {chartOf("enroll4w") > 0 ? (
              <Cell span={chartOf("enroll4w")}>
                <Panel sk={sk} title="최근 4주 등록 · 퇴원">
                  {weekly === null ? (
                    <PanelEmpty>증감을 불러오지 못했습니다</PanelEmpty>
                  ) : (
                    <WeeklyChangeBars buckets={weekly} />
                  )}
                </Panel>
              </Cell>
            ) : null}

            {chartOf("grades") > 0 ? (
              <Cell span={chartOf("grades")}>
                <Panel sk={sk} title="학년별 재원생" href="/students">
                  {(() => {
                    // 🔴 조회 실패와 "학생이 0명"을 구분한다 — 실패를 빈 막대로 그리지 않는다.
                    if (grades === null) return <PanelEmpty>학년 구성을 불러오지 못했습니다</PanelEmpty>;
                    const c = toCompositionBars(countByLabel(grades as (string | null)[]));
                    return (
                      <CompositionBars
                        bars={c.bars}
                        hiddenCount={c.hiddenCount}
                        hiddenValue={c.hiddenValue}
                        emptyLabel="재원생이 없습니다"
                      />
                    );
                  })()}
                </Panel>
              </Cell>
            ) : null}

            {chartOf("payments") > 0 ? (
              <Cell span={chartOf("payments")}>
                <Panel sk={sk} title="이번 달 수납 상태" href="/billing">
                  {payment === null ? (
                    <PanelEmpty>수납을 불러오지 못했습니다</PanelEmpty>
                  ) : (
                    // ⚠️ **건수 축**이다 — 같은 화면 수납 타일의 주숫자(수납률)는 금액 기준이라 축이 다르다.
                    //    그래서 제목 옆이 아니라 막대 라벨이 `완납·부분납·미납`이라 스스로 말한다.
                    <CompositionBars
                      bars={
                        toCompositionBars([
                          { label: "완납", value: payment.paidCount },
                          { label: "부분납", value: payment.partialCount },
                          { label: "미납", value: payment.fullyUnpaidCount },
                        ]).bars
                      }
                      hiddenCount={0}
                      hiddenValue={0}
                      emptyLabel="이번 달 청구가 없습니다"
                    />
                  )}
                </Panel>
              </Cell>
            ) : null}
          </>
        )
      }
    />
  );
}
