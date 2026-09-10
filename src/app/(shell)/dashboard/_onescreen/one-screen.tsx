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
import { buildWatchlist, watchlistOverflow } from "@/features/dashboard/onescreen/watchlist";
import { buildTodayActions } from "@/features/dashboard/today-actions";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getTodayActionSignals } from "@/features/dashboard/server/action-signals";
import { getDailyBriefing, type DailyBriefingRow } from "@/features/dashboard/server/briefing";
import {
  getAbsenceRiskCached,
  getDashboardAttendanceState,
  getEnrolledStudentCount,
  getFollowUpConsultations,
  getMonthlyEnrollmentChanges,
  getPaymentRateThisMonth,
  getRecentAnnouncements,
  getTopOutstandingCached,
  getTrendDataLast7Days,
} from "@/features/dashboard/server/queries";
import { getWeeklyChange } from "@/features/dashboard/onescreen/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { paymentRateDisplay, unpaidBreakdown } from "@/features/billing/calc";
import { formatWon } from "@/features/billing/textbook-notice";
import { dailyBriefingSummary } from "../_components/daily-briefing-card";
import { AttendanceTrend, WeeklyChangeBars } from "./charts";
import { Cell, OneScreenGrid } from "./grid";
import { BriefingNote, OutstandingList, TodoList, Watchlist } from "./panels";
import { KpiTile, Panel, PanelEmpty } from "./tiles";

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
}: {
  systemRole: SystemRole;
  permMatrix: AccessMatrix;
  tenantId: string;
}) {
  const access = resolveDashboardAccess(systemRole, permMatrix);
  // 브리핑은 payload가 master 관점 전신호(0114a)라 scoped 역할엔 통짜 서술이 새어 나간다 — 계속 제한한다.
  const canSeeBriefing = canManageStaff(systemRole);
  const areas: DashboardAreas = {
    attendance: access.read.attendance,
    billing: access.read.billing,
    students: access.read.students,
    consultations: access.read.consultations,
    staff: access.read.staff,
    briefing: canSeeBriefing,
  };
  const plan = buildDashboardPlan(areas);
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
    announcements,
    outstanding,
    trend,
    weekly,
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
          }),
        )
      : skip,
    need("todo") ? soft("학원 설정", getTenantSettings()) : skip,
    // ⚠️ 캐시본은 admin 클라이언트라 RLS를 안 탄다 — **이 줄의 권한 분기가 곧 게이트다**(queries.ts 주석).
    need("watchlist") && access.read.attendance ? soft("결석 위험", getAbsenceRiskCached(tenantId)) : skip,
    need("watchlist") && access.read.consultations ? soft("상담 후속", getFollowUpConsultations(8)) : skip,
    need("briefing") ? soft("일일 브리핑", getDailyBriefing(tenantId, today)) : skip,
    need("briefing") ? soft("공지", getRecentAnnouncements(systemRole, 3)) : skip,
    need("outstanding") ? soft("미납 상위", getTopOutstandingCached(tenantId)) : skip,
    need("attendance7d")
      ? soft("7일 추세", getTrendDataLast7Days(tenantId, { attendance: true, billing: false }))
      : skip,
    need("enroll4w") ? soft("4주 증감", getWeeklyChange()) : skip,
  ]);

  // ── 오늘 출결 ────────────────────────────────────────────────────────────────
  const startedIds = new Set((schedule ?? []).filter((s) => s.status !== "upcoming").map((s) => s.classId));
  const att = todayAttendanceKpi({ processing: attState?.todayProcessing ?? [], startedClassIds: startedIds });
  const attRate = closedAttendanceRate(att, attState?.snapshot ?? null, today);
  /**
   * 🔴 **시간표 조회 실패도 '실패'다.** 시간표가 없으면 `startedClassIds`가 비어 판정이 `none`이 되고,
   *    타일이 *"오늘 시작한 수업이 없습니다"* 라고 **거짓을 말한다**(수업은 돌고 있는데 화면만 조용하다).
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

  // ── 살펴볼 학생 ─────────────────────────────────────────────────────────────
  const watch = buildWatchlist(risks ?? [], followUps ?? []);
  const watchMore = watchlistOverflow(risks ?? [], followUps ?? []);

  // 🔴 조회 실패(`briefing === null`)를 "오늘 보고 없음"으로 위장하지 않는다 — 그 헬퍼가
  //    `unavailable` 인자로 그 구분을 이미 들고 있다([[#95]] 계열: 표 미적용도 여기로 떨어진다).
  const briefingSummary = dailyBriefingSummary(briefing as DailyBriefingRow | null, briefing === null);

  const kpiOf = (key: string) => plan.kpis.find((c) => c.key === key)?.span ?? 0;
  const bodyOf = (key: string) => plan.body.find((c) => c.key === key)?.span ?? 0;
  const chartOf = (key: string) => plan.charts.find((c) => c.key === key)?.span ?? 0;

  return (
    <OneScreenGrid
      kpis={
        <>
          {kpiOf("students") > 0 ? (
            <Cell span={kpiOf("students")}>
              <KpiTile
                label="재원생"
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
                      {" · 퇴원 "}
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
                label={att.mode === "closed" ? "오늘 출석률" : "출결 미기록"}
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
                      ? "오늘 시작한 수업이 없습니다"
                      : `시작한 ${att.startedClasses}개 반 · 기록 ${att.recorded}/${att.expected}명`
                }
              />
            </Cell>
          ) : null}

          {kpiOf("billing") > 0 ? (
            <Cell span={kpiOf("billing")}>
              <KpiTile
                label="이번 달 수납"
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
              />
            </Cell>
          ) : null}

          {kpiOf("todo") > 0 ? (
            <Cell span={kpiOf("todo")}>
              <KpiTile
                label="오늘 할 일"
                // 🔴 **건수를 합치지 않는다**(§2) — 신호마다 단위가 달라(명·건·개 반) 합계는 뜻이 없다.
                //    "몇 가지 일이 남았나"만 세고, 무엇인지는 바로 아래 목록이 말한다.
                value={signals === null ? null : String(todos.length)}
                unit="가지"
                tone={
                  signals === null
                    ? "inert"
                    : todos.some((t) => t.severity === "danger")
                      ? "critical"
                      : todos.length > 0
                        ? "caution"
                        : "positive"
                }
                sub={
                  signals === null
                    ? "신호를 불러오지 못했습니다"
                    : todos.length === 0
                      ? "지금 처리할 일이 없습니다"
                      : todos.slice(0, 2).map((t) => t.label).join(" · ")
                }
              />
            </Cell>
          ) : null}
        </>
      }
      body={
        <>
          {bodyOf("todo") > 0 ? (
            <Cell span={bodyOf("todo")}>
              <Panel title="오늘 할 일" count={signals === null ? undefined : `${todos.length}가지`}>
                {signals === null ? (
                  <PanelEmpty>신호를 불러오지 못했습니다</PanelEmpty>
                ) : (
                  <TodoList items={todos} />
                )}
              </Panel>
            </Cell>
          ) : null}

          {bodyOf("watchlist") > 0 ? (
            <Cell span={bodyOf("watchlist")}>
              <Panel title="살펴볼 학생" count={watch.length > 0 ? `${watch.length + watchMore}명` : undefined}>
                {risks === null && followUps === null ? (
                  <PanelEmpty>명단을 불러오지 못했습니다</PanelEmpty>
                ) : (
                  <Watchlist items={watch} overflow={watchMore} />
                )}
              </Panel>
            </Cell>
          ) : null}

          {bodyOf("briefing") > 0 ? (
            <Cell span={bodyOf("briefing")}>
              <Panel title="오늘 브리핑">
                <BriefingNote
                  summary={briefingSummary.text}
                  tone={briefingSummary.tone}
                  announcements={(announcements ?? []).map((a) => ({ id: a.id, title: a.title }))}
                />
              </Panel>
            </Cell>
          ) : null}

          {bodyOf("outstanding") > 0 ? (
            <Cell span={bodyOf("outstanding")}>
              <Panel title="미납 상위" href="/billing">
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
                <Panel title="최근 7일 출석률">
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
                <Panel title="최근 4주 등록 · 퇴원">
                  {weekly === null ? (
                    <PanelEmpty>증감을 불러오지 못했습니다</PanelEmpty>
                  ) : (
                    <WeeklyChangeBars buckets={weekly} />
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
