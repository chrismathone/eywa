"use client";

import { Fragment, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { DEFAULT_CHART_KINDS, type ChartKinds, type ChartPanel } from "@/features/dashboard/overview/chart-prefs";
import { saveDashboardChartKind } from "@/features/dashboard/overview/chart-prefs-actions";
import { DEFAULT_LAYOUT, type PanelId } from "@/features/dashboard/overview/layout";
import { ChartKindToggle } from "./chart-kind-toggle";
import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import {
  processingSummary,
  startedNote,
  type OverviewSnapshot,
  type Section,
} from "@/features/dashboard/overview/model";
import { concurrentShare } from "@/features/students/enrollment/enrolled-composition";
// 재원생 패널 ↗는 KPI 카드와 같은 주소 — "/students"만 적으면 계정에 저장된 필터가 끼어 숫자가 달라 보인다(F21).
import { admissionsStatsHref, attendanceStatsHref, billingStatsHref, consultProgressStatsHref, consultationStatsHref, newcomerStatsHref, expenseStatsHref, reportStatsHref, studentsEnrolledHref, studentsStatsHref } from "@/features/dashboard/overview/kpi-links";
import { DASHBOARD_SUBJECT_COLORS, STAFF_SUBJECT_LEGEND, dashboardSubjectColor, dashboardCombinationColor } from "@/features/dashboard/overview/subject-colors";
import { foldExpenseTotals } from "@/features/dashboard/overview/expense-total";
import { paymentRateDisplay } from "@/features/billing/calc";
import { monthDayLabel } from "@/lib/date-kst";
import { monthAheadNote, monthAheadWindow, windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
import { isCancelledAdmissionsRow, upcomingAdmissionsRows } from "@/features/dashboard/overview/display";
import { cancelledSuffix } from "@/features/calendar/cancelled";
import { useOverview } from "./use-overview";
import { DetailPopup } from "./detail-popup";
import { CurrentClasses } from "./current-classes";
import { TeacherWorkCard } from "./teacher-work-card";
import { EarlyExitsBody, earlyExitsHref } from "./early-exits-card";
import { counselPeriodLabel } from "@/features/dashboard/overview/counsel-period";
import { SchoolDistribution } from "./school-distribution";
import { AdmissionsSchedule } from "./admissions-schedule";
import { KpiStrip, kpiCards } from "./kpi-strip";
import { GridBoard } from "./grid-board";
import { identifyCard, useDashboardCardId } from "./card-id";
import { GradeSplitChart } from "./grade-split";
import { LevelSplitChart } from "./level-split";
import { AdmissionsComparison } from "./admissions-comparison";
import { ConsultChipsProvider, ConsultProgressBody } from "./consult-progress";
import { StudentSubjectBars, StudentSubjectLegend } from "./student-subject-bars";
import {
  Bars,
  Columns,
  Donut,
  AttendanceHistory,
  Stack,
  Legend,
  COLORS,
  number,
  money,
  chartMoney,
} from "./charts";
import { DemoRosterSwitch } from "../_components/demo-roster-switch";
import type { DemoRosterControl } from "@/features/demo-roster/types";
import s from "./overview.module.css";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";
import { SubjectBridge } from "./subject-bridge";
import appearance from "./appearance.module.css";

const clock = (at: number) =>
  new Date(at).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const monthLabel = (month: string) => `${Number(month.slice(5))}월`;
/** 차트 가로축 — 원장 2026-09-12 "하단 라벨 yy.mm": 2026-09 → 26.09(12칸이 좁은 폭에서도 한 줄). 머리 줄의 '9월'은 monthLabel 그대로. */
const axisMonth = (month: string) => `${month.slice(2, 4)}.${month.slice(5, 7)}`;
const subscribeHydration = () => () => {};

function OpenIcon({ size = 14 }: { size?: number }) {
  return <EyIcon name="externalLink" size={size} aria-hidden />;
}

function Jump({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <WindowLink href={href} className={className ?? s.jump}>
      {children}
      <OpenIcon size={14} aria-hidden />
    </WindowLink>
  );
}

function Panel({
  id,
  title,
  note,
  href,
  sections,
  children,
  wide = false,
  className = "",
  helpKey,
  tools,
}: {
  id?: string;
  title: string;
  note: string;
  href?: string;
  sections: (Section<unknown> | undefined)[];
  children: ReactNode;
  wide?: boolean;
  className?: string;
  helpKey?: string;
  /** 머리 오른쪽 '상세' 앞에 붙는 조작(막대/꺾은선 토글). */
  tools?: ReactNode;
}) {
  const cardId = useDashboardCardId();
  const visible = sections.filter((v) => !!v);
  if (!visible.length) return null;
  const failed = visible.some((v) => v.error);
  // 느린 것과 깨진 것은 다른 사실이다 — 같은 말로 적으면 어디를 봐야 할지 알 수 없다.
  const slow = visible.some((v) => v.timedOut);
  const times = visible.flatMap((v) => (v.at === null ? [] : [v.at]));
  const available = times.length > 0;
  return (
    <section
      id={id}
      data-overview="panel"
      data-dashboard-card={cardId}
      data-panel-title={title}
      data-wide={wide || undefined}
      data-help={helpKey}
      className={`${s.panel} ${wide ? s.wide : ""} ${className}`}
      aria-label={title}
    >
      <header className={s.panelHeader} data-overview="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{note}</p>
        </div>
        {tools || href ? (
          <div className={s.panelTools}>
            {tools}
            {href && (
              <Jump href={href}>
                <span className={s.srOnly}>{title} </span>상세
              </Jump>
            )}
          </div>
        ) : null}
      </header>
      <div className={s.panelBody} data-overview="panel-body">
        {available ? (
          children
        ) : (
          <p className={s.empty}>
            정보를 불러오지 못했습니다.
            <br />
            새로고침하면 다시 조회합니다.
          </p>
        )}
      </div>
      {failed && (
        <p className={s.errorNote}>
          {slow
            ? available
              ? `시간이 오래 걸려 일부를 못 갱신했습니다 · ${clock(Math.min(...times))} 확인값 표시 중`
              : "시간이 오래 걸려 못 불러왔습니다 · 0건을 의미하지 않습니다"
            : available
              ? `일부 갱신 실패 · ${clock(Math.min(...times))} 확인값 포함`
              : "조회 실패 · 0건을 의미하지 않습니다"}
        </p>
      )}
    </section>
  );
}

function InlineStat({
  label,
  value,
  danger = false,
  color,
}: {
  label: string;
  value: ReactNode;
  danger?: boolean;
  color?: string;
}) {
  return (
    <div className={s.inlineStat}>
      <span>{label}</span>
      <strong className={danger ? s.textDanger : undefined} style={color ? { color } : undefined}>{value}</strong>
    </div>
  );
}

export function Overview({
  initial,
  demoRoster = null,
  chartKinds: initialKinds = DEFAULT_CHART_KINDS,
  preview = false,
  onSwitchDesign,
  onPreloadDesign,
}: {
  initial: OverviewSnapshot;
  /** 추이 패널 막대/꺾은선 — 계정 귀속(`ui_prefs.dashboard`). */
  chartKinds?: ChartKinds;
  /** 데모 지점 원장에게만. 다른 지점은 null이라 버튼이 없다. */
  demoRoster?: DemoRosterControl | null;
  /** 학원 설정 '대시보드 관리'의 미리보기 — 갱신·실시간 구독을 끈다(역할로 다듬은 고정 스냅샷). */
  preview?: boolean;
  /** 맨 위 '대시보드 전환' — 미리보기·편집기에는 없다. */
  onSwitchDesign?: () => void;
  /** 버튼에 손이 갔을 때 — 전환 화면을 미리 받아 둔다. */
  onPreloadDesign?: () => void;
}) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const query = useOverview(initial, { live: !preview });
  const [kinds, setKinds] = useState<ChartKinds>(initialKinds);
  const kindTools = (panel: ChartPanel, label: string) => (
    <ChartKindToggle
      value={kinds[panel]}
      label={label}
      onChange={(k) => {
        setKinds((prev) => ({ ...prev, [panel]: k }));
        if (!preview) void saveDashboardChartKind(panel, k).catch(() => undefined); // 미리보기 조작은 계정 설정을 바꾸지 않는다
      }}
    />
  );
  const snapshot = query.data;
  const v = snapshot.sections;
  // 보는 사람의 배치(서버가 정한다) — 없으면(옛 스냅샷) 지금 운영실 그대로. 원장 기본만 옛 CSS 격자, 그 밖은 흐름 배치.
  const view = snapshot.view;
  const classic = !view ? DEFAULT_LAYOUT : view.mode === "classic" ? (view.classic ?? DEFAULT_LAYOUT) : null;
  const custom = new Map((view?.items ?? []).flatMap((i) => (i.title ? [[i.id, i.title] as const] : [])));
  const academyWide = new Set(view?.academyWide ?? []);
  // 카드 제목 = 편집기에서 바꾼 이름(없으면 기본) + 과목 관리자 화면에서 학원 전체 값이면 '(학원 전체)'.
  const t = (id: PanelId, base: string) => `${custom.get(`panel:${id}`) ?? base}${academyWide.has(`panel:${id}`) ? " (학원 전체)" : ""}`;
  const billingAmounts = view?.monthAmounts ?? true;
  const student = v.students?.data;
  const change = v.changes?.data;
  const enrolledTrend = v.enrolledTrend?.data;
  const courseTrend = v.courseTrend?.data;
  const ym = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
  const currentChange = change?.at(-1);
  const billing = v.billing?.data;
  const bill = billing?.at(-1);
  const attendance = v.attendance?.data;
  const processing = v.processing?.data
    ? processingSummary(v.processing.data)
    : null;
  // 오늘이 학원설정 휴원일이면 값이 있다 — 그날은 예정 분모가 없어 '미처리 N건'·입력 막대 대신 실제 입력만 적는다.
  const holidayAttendance = v.holidayAttendance?.data ?? null;
  const care = v.newcomers?.data;
  const schedule = v.schedule?.data;
  const consultations = v.consultations?.data;
  const admissions = v.admissions?.data;
  const homework = v.homework?.data;
  const unread = v.unread?.data;
  const subjects = (values: string[]) =>
    values.map((key) => snapshot.subjects[key] ?? key).join("·") || "전체 과목";
  const failed =
    query.isError || Object.values(v).some((section) => section.error);
  const lastTime = Object.values(v).flatMap((section) =>
    section.at === null ? [] : [section.at],
  );
  const carePeople = care?.checksAvailable
    ? new Set(
        care.items
          .filter((item) => !item.optional)
          .flatMap((item) => item.needs.map((p) => p.id)),
      ).size
    : null;
  const staff = v.staff?.data;
  // 원장 2026-09-12: "USD 지출 합계는 빼고 대충 환율 1,500원으로 지출 합계에 합쳐" — 환산은 순수 함수(expense-total.ts).
  const expenseTotal = v.expenses?.data ? foldExpenseTotals(v.expenses.data.byCurrency) : null;
  const thisMonth = monthLabel(snapshot.today.slice(0, 7));
  // '레벨테스트 및 첫수업 일정' 창 — 서버 조회(`add("calendar")`)와 **같은 함수·같은 오늘**(원장 2026-09-16 "오늘 기준으로 1달 이내").
  const admissionsRange = monthAheadWindow(snapshot.today);
  // '레벨테스트 및 첫수업 일정' = 오늘부터 — 일정 배열엔 KPI '전일 입테'용 어제 레벨테스트도 실린다(원장 2026-10-22).
  const admissionsRows = v.calendar?.data ? upcomingAdmissionsRows(v.calendar.data, snapshot.today) : null;
  const delta = currentChange
    ? currentChange.enrolled - currentChange.withdrawn
    : null;

  const panels: Partial<Record<PanelId, ReactNode>> = {
    studentsComp: (
    <Panel
      title={t("studentsComp", "재원생 구성")}
      note="현재 · 초·중·고 · 영어·동시수강·수학"
      href={studentsStatsHref("trend", { view: "mix", subject: view?.activeSubject, teacherView: snapshot.teacherView })}
      sections={[v.students]}
    >
      {student && (student.levelSplit
        ? <LevelSplitChart split={student.levelSplit} noEnrollment={student.academy?.noEnrollment ?? student.programs.noEnrollment} />
        : <Donut data={student.levels} label="전체 재원" />)}
    </Panel>
    ),
    /* 원장 2026-09-13 "출결 현황은 오늘것만 카운팅" — 오늘 기록이 없어도 지난 기록일로 넘어가지 않는다(attendance-day.ts).
    ↗ = 오늘 출결(원장 2026-09-14 "출결 현황 바로가기를 오늘의 출결과 연결") — 카드가 오늘만 세니 목적지도 오늘 화면.
    게이트는 월별과 같은 `attendance` 키라 숨김 조건이 따로 없다. 14일 추이(아래 '최근 14일 등원율')는 월별 그대로. */
    attendance: (
    <Panel
      title={t("attendance", "출결 현황")}
      note="오늘 · 학생·반·교시별 출결 칸"
      href="/attendance/live"
      sections={[v.attendance, v.processing, v.holidayAttendance]}
    >
      {attendance ? (
        <Donut
          data={[
            {
              label: "출석",
              value: attendance.present,
              color: COLORS[2],
            },
            { label: "결석", value: attendance.absent, color: "#b44832" },
            { label: "지각", value: attendance.late, color: COLORS[3] },
            {
              label: "사유",
              value: attendance.excused,
              color: COLORS[5],
            },
            {
              label: "보강·조퇴",
              value: Math.max(
                0,
                attendance.total -
                  attendance.present -
                  attendance.absent -
                  attendance.late -
                  attendance.excused,
              ),
              color: COLORS[4],
            },
          ]}
          label="출결 기록"
          unit="칸"
        />
      ) : (
        <p className={s.empty}>
          {v.attendance?.error
            ? "출결 조회 실패"
            : holidayAttendance
              ? "휴원일 — 오늘 입력된 출결이 없습니다."
              : "오늘 출결 기록이 아직 없습니다."}
        </p>
      )}
      {holidayAttendance ? (
        // 🔴 휴원일 = 분모 없음. '예정학생 미처리 N건'·'입력 중 N반'·입력 막대(기록/미처리)를 그리지 않는다 —
        //    예정 명단을 만들지 않는 날에 0건·빈 막대는 "다 처리했다"로 읽힌다. 실제로 입력된 것만 따로 적는다.
        <div className={s.smallStats} data-holiday-attendance="">
          <span>
            <b>{holidayAttendance.name}</b> 휴원일
          </span>
          {holidayAttendance.counts === null ? (
            <span>입력 현황을 불러오지 못했습니다</span>
          ) : (
            <>
              <span>
                입력된 출결 <b>{number(holidayAttendance.counts.students)}명</b> ·{" "}
                <b>{number(holidayAttendance.counts.classes)}반</b>
              </span>
              {holidayAttendance.counts.reservations > 0 ? (
                <span>
                  보강 예약 <b>{number(holidayAttendance.counts.reservations)}건</b>
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : processing && (
        <>
          <div className={s.smallStats}>
            <span>
              예정학생 미처리{" "}
              <b>
                {number(
                  Math.max(0, processing.expected - processing.recorded),
                )}
                건
              </b>
            </span>
            <span>
              입력 중 <b>{processing.partial}반</b>
            </span>
          </div>
          <Stack
            label="오늘 출결 입력"
            data={[
              {
                label: "기록",
                value: processing.recorded,
                color: COLORS[2],
              },
              {
                label: "미처리",
                value: Math.max(
                  0,
                  processing.expected - processing.recorded,
                ),
                color: "#e3e8ee",
              },
            ]}
          />
        </>
      )}
    </Panel>
    ),
    billingMonth: (
    <Panel
      title={t("billingMonth", `${thisMonth} 수납 현황`)}
      note="이번 달 청구서 · 취소 청구 제외"
      href={billingStatsHref(view?.activeSubject)}
      sections={[v.billing]}
    >
      {bill && (
        <>
          <Donut
            data={[
              { label: "완납", value: bill.paidCount, color: COLORS[2] },
              {
                label: "부분납",
                value: bill.partialCount,
                color: COLORS[3],
              },
              {
                label: "미납",
                value: bill.unpaidCount,
                color: "#b44832",
              },
              {
                label: "기타 상태",
                value:
                  bill.totalCount -
                  bill.paidCount -
                  bill.partialCount -
                  bill.unpaidCount,
                color: COLORS[5],
              },
            ]}
            label="청구서"
            unit="건"
          />
          {/* 원장 2026-09-13 *"미수랑 미수잔액이 두가진데 중복아닌가"* — 같은 값(`bill.outstanding`)을 라벨 줄과 각주가 두 번
              적고 있었다. 라벨 있는 줄만 남기고, `money`가 만원 단위로 반올림하며 지우는 원 단위는 마우스 오버로 남긴다.
              🔴 1만 원 미만은 원 단위로 적는다 — `money`면 3,000원이 빨간 "0만원"이 되는데, 그걸 풀어 주던 각주가 없고
              툴팁은 폰에서 없는 것과 같다(적대 리뷰 2026-09-13). */}
          <div className={s.separated}>
            {billingAmounts ? (
              <InlineStat
                label="미수 잔액"
                value={
                  <span title={`${number(bill.outstanding)}원`}>
                    {bill.outstanding < 10_000 ? `${number(bill.outstanding)}원` : money(bill.outstanding)}
                  </span>
                }
                danger={bill.outstanding > 0}
              />
            ) : (
              // 금액을 가린 역할(학원 설정 '대시보드 관리' — 원장 밖 역할 기본) — 건수만(미납 + 부분납). 금액 필드는 서버가 이미 0으로 비워 보냈다(shape.ts).
              <InlineStat
                label="미납·부분납 건수"
                value={
                  <>
                    {number(bill.unpaidCount + bill.partialCount)}
                    <small>건</small>
                  </>
                }
                danger={bill.unpaidCount + bill.partialCount > 0}
              />
            )}
            {/* 과목 관리자 화면(원장 2026-10-14 2단계 — 청구 항목별) — 반 이름으로 과목을 못 가른 청구 항목은 어느 과목에도 안 넣고
                따로 적는다(모든 과목 관리자에게 같은 값). 학원 전체 화면엔 이 칸이 없다(`unclassified` 없음).
                옆 칸과 같은 뜻으로 — 금액이 보이면 과목 모름 줄에 남은 **미수**, 가렸으면 그런 청구서 **건수**(재리뷰 2026-10-14:
                과목 모름 줄에만 미수가 남은 청구서가 어느 과목 화면에도 안 보였다). 청구 총액·항목 수는 툴팁으로. */}
            {bill.unclassified && bill.unclassified.lines > 0 ? (
              billingAmounts ? (
                <InlineStat
                  label="과목 모름 미수"
                  value={
                    <span title={`과목을 가리지 못한 청구 항목 ${number(bill.unclassified.lines)}개 · 청구 ${number(bill.unclassified.billed)}원 · 미수가 남은 청구서 ${number(bill.unclassified.count)}건`}>
                      {bill.unclassified.outstanding < 10_000 ? `${number(bill.unclassified.outstanding)}원` : money(bill.unclassified.outstanding)}
                    </span>
                  }
                  danger={bill.unclassified.outstanding > 0}
                />
              ) : (
                <InlineStat
                  label="과목 모름 미납·부분납"
                  value={
                    <span title={`과목을 가리지 못한 청구 항목 ${number(bill.unclassified.lines)}개`}>
                      {number(bill.unclassified.count)}
                      <small>건</small>
                    </span>
                  }
                  danger={bill.unclassified.count > 0}
                />
              )
            ) : null}
          </div>
        </>
      )}
    </Panel>
    ),
    newcomerStages: (
    <Panel
      title={t("newcomerStages", "신규생 단계별 관리")}
      note="등록 후 90일 · 재원·휴원 학생"
      href={snapshot.teacherView || view?.subjectScoped ? "/newcomers" : newcomerStatsHref()}
      sections={[v.newcomers]}
    >
      {care && (
        <>
          <StudentSubjectBars
            rows={care.stages.filter(
              (r) => r.value > 0 || r.label !== "90일 초과",
            )}
          />
          <StudentSubjectLegend rows={care.stages} />
          {care.checksAvailable ? (
            <div className={s.smallStats}>
              <span>
                기한 경과{" "}
                <b className={s.textDanger}>
                  {care.items
                    .filter((r) => !r.optional)
                    .reduce((sum, r) => sum + r.overdue, 0)}
                  건
                </b>
              </span>
              <span>
                3일 내 기한{" "}
                <b>
                  {care.items
                    .filter((r) => !r.optional)
                    .reduce((sum, r) => sum + r.due, 0)}
                  건
                </b>
              </span>
            </div>
          ) : (
            <p className={s.errorNote}>
              체크리스트를 불러오지 못했습니다.
            </p>
          )}
        </>
      )}
    </Panel>
    ),
    changes: (
    <Panel
      title={t("changes", "등록 · 퇴원 추이")}
      note={`최근 6개월 · 당월은 오늘까지 · 퇴원은 ${EXIT_BASIS_TAG}${change && startedNote(change) ? ` · ${startedNote(change)}` : ""}`}
      href={studentsStatsHref("flow", { subject: view?.activeSubject, teacherView: snapshot.teacherView })}
      sections={[v.changes]}
      wide
      tools={kindTools("changes", "등록 · 퇴원 추이")}
    >
      {change && (
        <>
          <div className={s.chartHeadline}>
            <b>
              {thisMonth} 순증{" "}
              <strong
                className={
                  delta !== null && delta < 0 ? s.textDanger : s.textGreen
                }
              >
                {delta !== null && delta > 0 ? "+" : ""}
                {delta}명
              </strong>
            </b>
          </div>
          <Columns
            kind={kinds.changes}
            labels={change.map((r) => axisMonth(r.month))}
            axisFormat={(n) => (Number.isInteger(n) ? `${number(n)}명` : "")}
            series={[
              {
                name: "등록",
                color: COLORS[0],
                values: change.map((r) => r.enrolled),
              },
              {
                name: "퇴원",
                color: "#c77263",
                values: change.map((r) => r.withdrawn),
              },
            ]}
          />
        </>
      )}
    </Panel>
    ),
    /* 등록 후 3개월 내 퇴원(원장 2026-10-15) — 이번 달 퇴원 중 등록일부터 30·60·90일 안에 그만둔 학생. 판정은 퇴원관리
    '등록 후' 필터와 같은 함수(early-exit.ts) · ↗ = 퇴원관리의 같은 필터(3개월 이내). */
    earlyExits: (
    <Panel
      title={t("earlyExits", "등록 후 3개월 내 퇴원")}
      note={`이번 달 퇴원(${EXIT_BASIS_TAG}) · 등록일부터 30·60·90일`}
      href={earlyExitsHref(v.earlyExits?.data?.month ?? snapshot.today.slice(0, 7))}
      sections={[v.earlyExits]}
    >
      {v.earlyExits?.data && (
        <EarlyExitsBody data={v.earlyExits.data} scope={view?.subjectScoped ? (view.scopeLabel ?? null) : null} />
      )}
    </Panel>
    ),
    billing6: (
    <Panel
      title={t("billing6", "6개월 청구 · 수납")}
      note="최근 6개월 · 청구월 기준 실청구액(청구 − 할인)"
      href={billingStatsHref(view?.activeSubject)}
      sections={[v.billing]}
      wide
      tools={kindTools("billing", "6개월 청구 · 수납")}
    >
      {billing && (
        <>
          {/* 막대는 실청구(청구 − 할인) 하나(원장 2026-09-12 "청구액과 수납액이 그렇게 차이가 안 나는데 두 개 다 있을 필요가 없다") —
              수납은 이번 달 값만 머리 줄에 적는다(제목의 '수납'이 거짓이 되지 않게). 🔴 `.chartHeadline > span`은 좁은 폭에서
              숨는 규칙이 있어 이 글은 `<i>`로 — 수납 숫자가 노트북에서 사라지면 안 된다. 수납률 글자는 정본 `paymentRateDisplay`
              (미수가 남아 있으면 100%로 반올림하지 않는다 — 원장 2026-09-10). */}
          <div className={s.chartHeadline}>
            <b>
              {thisMonth} 실청구{" "}
              <strong>
                {bill ? chartMoney(bill.totalBilled - bill.totalDiscount) : "—"}
              </strong>
            </b>
            {bill && (
              <i className={s.chartHeadlineNote}>
                수납 {chartMoney(bill.totalCollected)} · 수납률 {paymentRateDisplay(bill.paymentRate, bill.outstanding)}%
              </i>
            )}
          </div>
          <Columns
            kind={kinds.billing}
            labels={billing.map((r) => axisMonth(r.period))}
            series={[
              {
                name: "실청구",
                color: COLORS[0],
                values: billing.map(
                  (r) => r.totalBilled - r.totalDiscount,
                ),
              },
            ]}
            unit="원"
            format={chartMoney}
            valueLabels="all"
          />
        </>
      )}
    </Panel>
    ),
    /* 재원생 추이(원장 2026-09-29 "재원생 수치: 연간, 월간 흐름을 볼 수 있도록") — 막대 = 달마다 말일(이번 달은 오늘) 재원생,
    아래 줄 = 해마다 연말(올해는 오늘). 판정은 '재원생' 카드와 같은 뜻을 그날로 되감은 것(enrolled-trend.ts) — 오늘 칸 = 카드.
    한 줄 전체 폭(원장 "우하단에 빈공간이 크게 남아") — wide 셋이면 넷째 칸이 빈다. */
    /* 강사 스코프만 숨긴다 = 조회에 **성공한 적 있는데**(at) 값이 null. 갱신 실패는 옛 섹션에 error만 얹으므로
    (model.ts mergeSnapshot) error로 가르면 강사에게 오류 패널이 드러난다. 첫 조회 실패·시간 초과(at=null)는 Panel이 알린다. */
    enrolledTrend: (
    !(v.enrolledTrend && v.enrolledTrend.data === null && v.enrolledTrend.at !== null) ? (
      <Panel
        title={t("enrolledTrend", "재원생 추이")}
        note={`${enrolledTrend?.monthlyFrom ? `${enrolledTrend.monthlyFrom.slice(0, 4)}년 ${Number(enrolledTrend.monthlyFrom.slice(5, 7))}월부터` : "최근 12개월"} · 달마다 말일 기준(이번 달은 오늘) · 휴원 제외 · 퇴원은 ${EXIT_BASIS_TAG}`}
        href={studentsStatsHref("trend", { subject: view?.activeSubject, teacherView: snapshot.teacherView })}
        sections={[v.enrolledTrend]}
        className={s.fullRow}
        tools={kindTools("enrolledTrend", "재원생 추이")}
      >
        {enrolledTrend && (
          <>
            <div className={s.chartHeadline}>
              <b>
                오늘 재원생 <strong>{number(enrolledTrend.monthly.at(-1)?.count ?? 0)}명</strong>
              </b>
              <i className={s.chartHeadlineNote}>
                {enrolledTrend.yearly
                  .map((y, i, all) => `${y.label}${i === all.length - 1 ? "(오늘)" : " 말"} ${number(y.count)}명`)
                  .join(" · ")}
              </i>
            </div>
            <Columns
              kind={kinds.enrolledTrend}
              labels={enrolledTrend.monthly.map((p) => axisMonth(p.key))}
              axisFormat={(n) => (Number.isInteger(n) ? `${number(n)}명` : "")}
              valueLabels="all"
              series={[{ name: "재원생", color: COLORS[0], values: enrolledTrend.monthly.map((p) => p.count) }]}
            />
            {/* 에이와 수강 기록이 갖춰진 달부터만 보인다(원장 2026-10-20 '2026년 4월부터' · record-coverage.ts) — 그 전은 원생 통계 '지난 기록'. */}
            {enrolledTrend.trustFrom ? (
              <p className={s.footnote}>에이와 수강 기록이 갖춰진 {enrolledTrend.trustFrom.slice(0, 4)}년 {Number(enrolledTrend.trustFrom.slice(5, 7))}월부터 보입니다 — 그 전 흐름은 원생 통계 &apos;지난 기록&apos;에서 봅니다.</p>
            ) : enrolledTrend.recordsFrom ? (
              <p className={s.footnote}>퇴원 기록은 {enrolledTrend.recordsFrom.slice(0, 4)}년 {Number(enrolledTrend.recordsFrom.slice(5, 7))}월부터 있어 연도별은 그 해부터 셉니다.</p>
            ) : null}
          </>
        )}
      </Panel>
    ) : null
    ),
    /* 강좌수 추이(원장 2026-10-20 '카드 따로') — 막대 = 달마다 말일(이번 달은 오늘) 강좌수. 판정은 '강좌수' 칸과 같은 뜻을 그날로 되감은 것
    (course-trend.ts — 학생마다 그날 듣던 반을 모두) · 재원생 추이와 같은 원본·같은 시작 달 · 숨김 규칙도 재원생 추이와 같다. */
    courseTrend: (
    !(v.courseTrend && v.courseTrend.data === null && v.courseTrend.at !== null) ? (
      <Panel
        title={t("courseTrend", "강좌수 추이")}
        note={`${courseTrend?.historyFrom ? `${ym(courseTrend.historyFrom)}부터(앞쪽은 지난 기록)` : courseTrend?.monthlyFrom ? `${ym(courseTrend.monthlyFrom)}부터` : "최근 12개월"} · 달마다 말일 기준(이번 달은 오늘) · 학생마다 같은 과목은 1개`}
        href={studentsStatsHref("courses", { subject: view?.activeSubject, teacherView: snapshot.teacherView })}
        sections={[v.courseTrend]}
        className={s.fullRow}
        tools={kindTools("courseTrend", "강좌수 추이")}
      >
        {courseTrend && (
          <>
            <div className={s.chartHeadline}>
              <b>
                오늘 강좌수 <strong>{number(courseTrend.monthly.at(-1)?.count ?? 0)}개</strong>
              </b>
              <i className={s.chartHeadlineNote}>
                {courseTrend.yearly.map((y, i, all) => `${y.label}${i === all.length - 1 ? "(오늘)" : " 말"} ${number(y.count)}개`).join(" · ")}
              </i>
            </div>
            <Columns
              kind={kinds.courseTrend}
              unit="개"
              labels={courseTrend.monthly.map((p) => axisMonth(p.key))}
              axisFormat={(n) => (Number.isInteger(n) ? `${number(n)}개` : "")}
              valueLabels="all"
              series={[{ name: "강좌수", color: COLORS[0], values: courseTrend.monthly.map((p) => p.count) }]}
            />
            {courseTrend.historyFrom && courseTrend.historyTo ? (
              <p className={s.footnote}>
                {`${ym(courseTrend.historyFrom)}~${ym(courseTrend.historyTo)}은 지난 기록(그달 과목마다 수업료가 청구된 학생 수의 합 · 과학·국어 포함)으로 센 추정입니다. ${courseTrend.trustFrom ? `${ym(courseTrend.trustFrom)}부터 에이와 수강 기록으로 셉니다.` : ""}`}
              </p>
            ) : courseTrend.trustFrom ? (
              <p className={s.footnote}>
                {courseTrend.cutBy === "records"
                  ? `강좌수는 ${ym(courseTrend.trustFrom)}부터 보입니다 — 그 전에 그만둔 학생은 수강 기록이 남아 있지 않아 과목별 수강을 셀 수 없습니다.`
                  : `에이와 수강 기록이 갖춰진 ${ym(courseTrend.trustFrom)}부터 보입니다 — 그 전 달은 옮겨 오기 전 학생의 수강 시작일이 늦게 잡혀 실제보다 적게 나옵니다.`}
              </p>
            ) : null}
          </>
        )}
      </Panel>
    ) : null
    ),
    subjects: (
    <Panel
      title={t("subjects", "과목별 수강")}
      note="현재 재원생 · 과목별 수강과 동시 수강"
      href={studentsStatsHref("trend", { view: "subject", subject: view?.activeSubject, teacherView: snapshot.teacherView })}
      sections={[v.students]}
    >
      {student && (
        <>
          <Bars
            data={student.subjects.map((r) => ({
              ...r,
              label: snapshot.subjects[r.label] ?? r.label,
              color: dashboardSubjectColor(r.label, snapshot.subjects),
            }))}
            limit={6}
            title="과목별 수강"
          />
          <SubjectBridge student={student} courses={v.courses?.data?.total ?? null} />
          <div className={s.separated}>
            {/* 동시 수강 = 영어(EiE·인재원 영어) + 수학(수학(심화) 포함) — 원장 2026-09-11 재정의.
                학년별 재원생 막대의 보라 합계와 같은 판정(subjectMixOf)이라 두 수가 늘 같다. */}
            <InlineStat
              label="동시 수강(영어+수학)"
              color={DASHBOARD_SUBJECT_COLORS.both}
              value={
                <>
                  {number(student.concurrent)}
                  <small>
                    명
                    {concurrentShare(student.concurrent, student.enrolled) === null
                      ? ""
                      : ` (${concurrentShare(student.concurrent, student.enrolled)}%)`}
                  </small>
                </>
              }
            />
            <Bars
              data={(student.subjectCombinations ?? []).map(
                (group) => ({
                  label:
                    group.subjects
                      .map((key) => snapshot.subjects[key] ?? key)
                      .join("·") +
                    (group.subjects.length === 1 ? "만" : ""),
                  value: group.value,
                  color: dashboardCombinationColor(group.subjects, snapshot.subjects),
                }),
              )}
              limit={4}
              title="과목 수강 조합"
            />
          </div>
        </>
      )}
    </Panel>
    ),
    grades: (
    <Panel
      title={t("grades", "학년별 재원생")}
      note="현재 재원생 · 학원설정 학년 순 · 영어·수학 수강 구성"
      href={studentsEnrolledHref()}
      sections={[v.students]}
    >
      {student && <GradeSplitChart split={student.gradeSplit} noEnrollment={student.academy?.noEnrollment ?? student.programs.noEnrollment} />}
    </Panel>
    ),
    schools: (
    <Panel
      title={t("schools", "학교별 학생")}
      note="현재 재원생 · 초등·중등·고등"
      className={s.schoolPanel}
      href={studentsEnrolledHref()}
      sections={[v.students]}
    >
      {student &&
        (student.schoolGroups ? (
          <SchoolDistribution groups={student.schoolGroups} />
        ) : (
          <Bars data={student.schools} limit={6} title="학교별 재원생" />
        ))}
    </Panel>
    ),
    admissions: (
    <Panel
      title={t("admissions", "신규 콜&상담 전환")}
      note="지난달 · 이번 달 · 접수일 기준"
      href={snapshot.teacherView || view?.subjectScoped ? undefined : admissionsStatsHref()}
      sections={[v.admissions]}
    >
      {admissions && <AdmissionsComparison stats={admissions} today={snapshot.today} />}
    </Panel>
    ),
    repeatAbsence: (
    <Panel
      id="repeated-absences"
      className={s.fadeScroll}
      title={t("repeatAbsence", "반복 결석 학생")}
      note={
        v.absences?.data?.anchor
          ? `${monthDayLabel(v.absences.data.anchor)}까지 14일 · 사전 통보 제외 3회 이상`
          : "최근 14일 · 사전 통보 제외"
      }
      sections={[v.absences]}
    >
      {v.absences?.data && (
        <>
          <InlineStat
            label="확인이 필요한 학생"
            value={
              <>
                {v.absences.data.rows.length}
                <small>명</small>
              </>
            }
            danger={v.absences.data.rows.length > 0}
          />
          {/* 첫 화면엔 이름 없이 결석 횟수별 인원만 — 원장 2026-10-29 *"대시보드 첫 화면에 이름이 직접 뜨지 않게 … 상세를 누르면 개별 리스트"*. */}
          {v.absences.data.rows.length > 0 && (
            <p className={s.footnote}>
              {[3, 4].map((n) => `${n}회 ${v.absences!.data!.rows.filter((row) => row.unexplained === n).length}명`)
                .concat(`5회 이상 ${v.absences.data.rows.filter((row) => row.unexplained >= 5).length}명`).join(" · ")}
            </p>
          )}
          {v.absences.data.rows.length > 0 && (
            <DetailPopup
              title="반복 결석 학생"
              label={`명단 보기 (${v.absences.data.rows.length}명)`}
              ariaLabel={`반복 결석 학생 명단 보기 (${v.absences.data.rows.length}명)`}
            >
              <div className={s.riskNames}>
                {v.absences.data.rows.map((row) => (
                  <WindowLink
                    key={row.studentId}
                    href={`/students/${row.studentId}?tab=attendance`}
                    title={`${row.studentName} 출결`}
                    ariaLabel={`${row.studentName} 출결 상세 · 결석 ${row.unexplained}회`}
                  >
                    <span>{row.studentName}</span>
                    <b>
                      {row.unexplained}
                      <small>회</small>
                    </b>
                  </WindowLink>
                ))}
              </div>
            </DetailPopup>
          )}
          {v.absences.data.rows.length === 0 && (
            <p className={s.footnote}>
              이 기준에 해당하는 학생이 없습니다.
            </p>
          )}
        </>
      )}
    </Panel>
    ),
    attendance14: (
    <Panel
      title={t("attendance14", "최근 14일 등원율")}
      note="오늘 포함 14일 · (출석 + 지각) / 유효 출결 칸"
      href={snapshot.teacherView ? "/attendance" : attendanceStatsHref(view?.activeSubject)}
      sections={[v.attendanceTrend]}
    >
      {v.attendanceTrend?.data && (
        <>
          <AttendanceHistory points={v.attendanceTrend.data} />
        </>
      )}
    </Panel>
    ),
    consultProgress: (
    <Panel
      title={t("consultProgress", "상담 진행")}
      note={
        v.consultProgress?.data
          ? `접수일 기준 ${monthDayLabel(v.consultProgress.data.summary.from)}부터 · 접수 → 수업 시작`
          : "접수일 기준 최근 30일 · 접수 → 수업 시작"
      }
      href={snapshot.teacherView || view?.subjectScoped ? "/enrollment" : consultProgressStatsHref()}
      sections={[v.consultProgress]}
    >
      {v.consultProgress?.data && <ConsultProgressBody data={v.consultProgress.data} subjects={snapshot.subjects} />}
    </Panel>
    ),
    reports: (
    <Panel
      title={t("reports", "학습 · 학부모 보고")}
      note={
        homework
          ? `최근 ${homework.windowDays}일 숙제 · ${subjects(homework.subjects)}`
          : "수업보고서 기준"
      }
      href={snapshot.teacherView ? "/lesson-reports?tab=list" : reportStatsHref(view?.activeSubject)}
      sections={[v.homework, v.unread]}
    >
      {homework && (
        <>
          <InlineStat
            label="숙제 수행률 60% 미만 학생"
            value={
              <>
                {number(homework.students)}
                <small>명</small>
              </>
            }
            danger={homework.students > 0}
          />
          <Bars
            data={[
              {
                label: "미제출 학생",
                value: homework.notSubmitted,
                color: COLORS[3],
              },
              {
                label: "수행률 0% 학생",
                value: homework.zero,
                color: "#b44832",
              },
            ]}
          />
        </>
      )}
      {unread && (
        <div className={s.separated}>
          <InlineStat
            label={`수업보고서 미확인 건 (${unread.graceHours}시간 초과)`}
            value={
              <>
                {number(unread.reports)}
                <small>건</small>
              </>
            }
          />
          <p className={s.footnote}>
            최근 {unread.windowDays}일 · {subjects(unread.subjects)}
          </p>
        </div>
      )}
    </Panel>
    ),
    studentConsult: (
    <Panel
      title={t("studentConsult", "학생 상담")}
      note="최근 7일 · 전체 기록 · 후속조치"
      href={consultationStatsHref()}
      sections={[v.consultations]}
    >
      {consultations && (
        <>
          <InlineStat
            label="최근 7일 상담"
            value={
              <>
                {number(consultations.lastWeek)}
                <small>건</small>
              </>
            }
          />
          <Bars
            data={[
              {
                label: "기한 경과",
                value: consultations.overdueFollowUps,
                color: "#b44832",
              },
              {
                label: "기한 예정",
                value:
                  consultations.pendingFollowUps -
                  consultations.overdueFollowUps,
                color: COLORS[0],
              },
            ]}
            unit="건"
          />
          <div className={s.smallStats}>
            <span>
              이번 달 상담 <b>{number(consultations.thisMonth)}건</b>
            </span>
            <Jump href="/consultations?urg=overdue">후속조치 확인</Jump>
          </div>
        </>
      )}
    </Panel>
    ),
    newcomerChecks: (
    <Panel
      title={t("newcomerChecks", "신규생 체크 진행")}
      note="등록 후 90일 · 필수 6항목 · 2개월 콜은 선택"
      href={snapshot.teacherView || view?.subjectScoped ? "/newcomers" : newcomerStatsHref()}
      sections={[v.newcomers]}
    >
      {care?.checksAvailable ? (
        <>
          <div className={s.checks}>
            {care.items.map((item) => (
              <div
                key={item.label}
                title={
                  item.needs.length
                    ? `확인 필요 ${item.needs.length}명` // 이름은 눌러서 여는 명단에서만(원장 2026-10-29)
                    : "현재 확인이 필요한 학생 없음"
                }
              >
                <span>
                  {item.label}
                  {item.optional && <small>선택</small>}
                </span>
                <Stack
                  label={item.label}
                  data={[
                    { label: "완료", value: item.done, color: COLORS[2] },
                    {
                      label: "기한 경과",
                      value: item.overdue,
                      color: "#b44832",
                    },
                    {
                      label: "3일 내",
                      value: item.due,
                      color: COLORS[3],
                    },
                    {
                      label: "예정·기한 미정·시작 전",
                      value: item.upcoming + item.pending + item.waived,
                      color: "#e3e8ee",
                    },
                  ]}
                />
                <b>
                  {item.done}
                  <small>/{care.total}</small>
                </b>
              </div>
            ))}
          </div>
          <Legend
            items={[
              { label: "완료", color: COLORS[2] },
              { label: "기한 경과", color: "#b44832" },
              { label: "3일 내", color: COLORS[3] },
            ]}
          />
          <p className={s.footnote}>
            회색: 예정·기한 미정·기능 시작 전 항목
          </p>
          {carePeople !== null && carePeople > 0 && (
            <DetailPopup
              title="신규생 케어 확인"
              label={`확인이 필요한 학생 ${carePeople}명`}
            >
              {care.items
                .filter((item) => !item.optional && item.needs.length)
                .map((item) => (
                  <p key={item.label}>
                    <b>{item.label}</b> ·{" "}
                    {item.needs.map((p, index) => (
                      <span key={p.id}>
                        {index > 0 && ", "}
                        <WindowLink
                          href={`/students/${p.id}`}
                          title={`${p.name} 학생 상세`}
                          className={s.studentLink}
                          ariaLabel={`${p.name} 학생 상세`}
                        >
                          {p.name}
                        </WindowLink>
                      </span>
                    ))}
                  </p>
                ))}
            </DetailPopup>
          )}
        </>
      ) : (
        <p className={s.empty}>체크리스트 연결 확인이 필요합니다.</p>
      )}
    </Panel>
    ),
    sheets: (
    <Panel
      title={t("sheets", "강사 시트 작성 현황")}
      // 영어 = 오늘이 속한 주 · 수학 = 이번 달 1일~오늘 — 볼 수 있는 줄만 적는다. 영어는 계정의 보기 필터(프로그램·담임)를 탄 반만 센다
      // (수학은 권한 범위로만 거른다).
      note={[v.englishSheet ? "영어 이번 주(보기 필터 기준)" : null, v.mathSheet ? "수학 이번 달" : null]
        .filter(Boolean)
        .join(" · ")}
      sections={[v.englishSheet, v.mathSheet]}
    >
      {(
        [
          {
            section: v.englishSheet,
            label: "영어",
            subject: "english",
            href: "/ecs",
            unit: "교시",
          },
          {
            section: v.mathSheet,
            label: "수학",
            subject: "math",
            href: "/mcs",
            unit: "학생·수업일",
          },
        ] as const
      )
        .filter((row) => row.section)
        .map(({ section, label, subject, href, unit }) => (
          <div className={s.sheetSummary} key={label}>
            <div>
              <Jump href={href}><span style={{ color: DASHBOARD_SUBJECT_COLORS[subject] }}>{label} 시트</span></Jump>
              <span>{section?.data?.period}</span>
            </div>
            {section?.data ? (
              <>
                <InlineStat
                  label={`${section.data.classes}개 반 · 작성률`}
                  value={
                    section.data.total > 0
                      ? `${Math.round((section.data.filled / section.data.total) * 100)}%`
                      : "—"
                  }
                />
                <Stack
                  label={`${label} 작성`}
                  data={[
                    {
                      label: "작성",
                      value: section.data.filled,
                      color: DASHBOARD_SUBJECT_COLORS[subject],
                    },
                    {
                      label: "미작성",
                      value: Math.max(
                        0,
                        section.data.total - section.data.filled,
                      ),
                      color: "#e3e8ee",
                    },
                  ]}
                />
                <p className={s.footnote}>
                  {number(section.data.filled)} /{" "}
                  {number(section.data.total)} {unit}
                  {section.data.total === 0 ? " · 작성 대상 없음" : ""}
                </p>
              </>
            ) : (
              <p className={s.errorNote}>조회 실패</p>
            )}
          </div>
        ))}
    </Panel>
    ),
    teacherWork: (
      <Panel title={t("teacherWork", "강사별 업무 현황")}
        note={teacherWorkNote(v.teacherWork?.data)} sections={[v.teacherWork]}>
        {v.teacherWork?.data ? <TeacherWorkCard data={v.teacherWork.data} subjects={snapshot.subjects} /> : null}
      </Panel>
    ),
    nowClasses: (
    <Panel
      title={t("nowClasses", "현재 수업 현황")}
      helpKey="dash-now"
      note={
        v.schedule?.at
          ? `오늘 ${clock(v.schedule.at)} 기준 · 과목별`
          : "오늘 시간표"
      }
      href="/timetable"
      sections={[v.schedule]}
    >
      {schedule && (
        <CurrentClasses
          schedule={schedule}
          subjects={snapshot.subjects}
        />
      )}
    </Panel>
    ),
    admissionsSchedule: (
    <Panel
      title={t("admissionsSchedule", "레벨테스트 및 첫수업 일정")}
      note={monthAheadNote(admissionsRange)}
      sections={[v.calendar]}
    >
      <AdmissionsSchedule events={admissionsRows ?? []} limit={0} />
      {admissionsRows?.length === 0 && (
        <p className={s.empty}>
          오늘부터 {windowUntilLabel(admissionsRange)} 레벨테스트·첫 수업 일정이 없습니다.
        </p>
      )}
      {(admissionsRows?.length ?? 0) > 0 && (
        <DetailPopup
          title="레벨테스트 및 첫수업 일정"
          // 열 머리·전일 입테와 같은 축 — 숫자는 살아 있는 일정만, 취소는 " · 취소 N"으로 따로(원장 2026-09-30).
          label={`일정 보기 (${admissionsRows!.filter((event) => !isCancelledAdmissionsRow(event)).length}개)${cancelledSuffix(admissionsRows!.filter(isCancelledAdmissionsRow).length)}`}
          ariaLabel={`레벨테스트 및 첫수업 일정 보기 (${admissionsRows!.filter((event) => !isCancelledAdmissionsRow(event)).length}개)`}
        >
          <AdmissionsSchedule events={admissionsRows!} />
        </DetailPopup>
      )}
    </Panel>
    ),
    staff: (
    <Panel
      title={t("staff", "직원 구성")}
      note="현재 재직 중 · 운영 역할 기준"
      href="/staff"
      sections={[v.staff]}
    >
      {staff && (
        <>
          <InlineStat
            label="재직 직원"
            value={
              <>
                {number(staff.reduce((sum, row) => sum + row.value, 0))}
                <small>명</small>
              </>
            }
          />
          {/* 원장 2026-09-12: "수학강사 영어강사 색깔 구분 · 과목 없는 강사는 그냥 진한 회색 · 관리자도 마찬가지" —
              역할 막대 하나를 과목 묶음 조각으로 갈라 칠한다. 색은 학년별 재원생 막대와 같은 값(STAFF_SUBJECT_LEGEND). */}
          <Bars
            data={staff.map((row) => ({
              label: row.label,
              value: row.value,
              segments: STAFF_SUBJECT_LEGEND.filter((g) => row.bySubject[g.key] > 0).map((g) => ({
                label: g.label,
                value: row.bySubject[g.key],
                color: g.color,
              })),
            }))}
            limit={5}
            color={DASHBOARD_SUBJECT_COLORS.unenrolled}
            title="직원 구성"
            footer={
              staff.length > 0 ? (
                <Legend
                  items={STAFF_SUBJECT_LEGEND.filter((g) => staff.some((row) => row.bySubject[g.key] > 0))}
                />
              ) : null
            }
          />
        </>
      )}
    </Panel>
    ),
    operations: (
    <Panel
      title={t("operations", "행정 · 자산")}
      note="현재 · 누적 건수 · 열람 가능한 업무 기준"
      sections={[v.operations]}
    >
      <div className={s.operations}>
        {v.operations?.data?.map((item) => (
          <WindowLink
            key={item.label}
            href={item.href}
            className={s.operation}
          >
            <span>{item.label}</span>
            <b>
              {item.count === null ? "—" : number(item.count)}
              <small>
                {item.count === null ? "조회 실패" : item.unit}
              </small>
            </b>
            <OpenIcon size={14} />
          </WindowLink>
        ))}
      </div>
      {v.operations?.data?.length === 0 && (
        <p className={s.empty}>열람 가능한 행정 업무가 없습니다.</p>
      )}
    </Panel>
    ),
    expenses: (
    <Panel
      title={t("expenses", `${thisMonth} 지출 내역`)}
      note={
        v.expenses?.data
          ? `이번 달 · 지출일 기준 · ${v.expenses.data.count}건`
          : "이번 달 지출결의서 기준"
      }
      href={expenseStatsHref()}
      sections={[v.expenses]}
    >
      {v.expenses?.data && (
        <>
          <Bars
            data={v.expenses.data.byCategory.map((c) => ({
              label: c.category,
              value: c.amount,
            }))}
            unit={
              v.expenses.data.primaryCurrency === "KRW"
                ? "원"
                : v.expenses.data.primaryCurrency
            }
            color={COLORS[3]}
            limit={5}
            title="분류별 지출"
          />
          <div className={s.separated}>
            {/* 합계 한 줄 — 환율이 있는 외화(USD 1,500원)는 원화에 합치고 라벨에 그 사실을 적는다(정산이 아니라 눈대중).
                환율이 없는 통화만 종전처럼 따로 선다. */}
            {expenseTotal && v.expenses.data.count > 0 && (
              <InlineStat
                label={
                  expenseTotal.converted.length
                    ? `지출 합계 · ${expenseTotal.converted.map((c) => `${c.currency} ${number(c.rate)}원 환산 포함`).join(" · ")}`
                    : "지출 합계"
                }
                value={money(expenseTotal.krwTotal)}
              />
            )}
            {expenseTotal?.unconverted.map((c) => (
              <InlineStat
                key={c.currency}
                label={`${c.currency} 지출 합계`}
                value={`${number(c.total)} ${c.currency}`}
              />
            ))}
          </div>
          {v.expenses.data.count === 0 && (
            <p className={s.empty}>이번 달 지출 내역이 없습니다.</p>
          )}
        </>
      )}
    </Panel>
    ),
    notices: (
    <Panel
      title={t("notices", "학원 공지")}
      note="최근 공지 · 대상 권한 반영"
      href="/dashboard/announcements"
      sections={[v.notices]}
    >
      <div className={s.notices}>
        {v.notices?.data?.map((notice) => (
          <DetailPopup
            key={notice.id}
            title={notice.title}
            plain
            label={
              <>
                <span>
                  {notice.pinned && <em>고정</em>}
                  {notice.title}
                </span>
                <time>{monthDayLabel(notice.createdAt.slice(0, 10))}</time>
              </>
            }
          >
            <p className={s.noticeContent}>{notice.content}</p>
          </DetailPopup>
        ))}
      </div>
      {v.notices?.data?.length === 0 && (
        <p className={s.empty}>등록된 공지가 없습니다.</p>
      )}
      <Jump href="/dashboard/announcements">공지 관리 열기</Jump>
    </Panel>
    ),
  };

  for (const key of Object.keys(panels) as PanelId[]) panels[key] = identifyCard(`panel:${key}`, panels[key]);

  // 학습·학부모 보고 + 학생 상담은 기본 배치에서 한 묶음(2열) — 둘 다 영역이 없으면 묶음 자체가 없다.
  const followup =
    v.homework || v.unread || v.consultations ? (
      <div className={s.followupPanels}>
        {panels.reports}
        {panels.studentConsult}
      </div>
    ) : null;

  return (
    // 콜&상담 진행 칩(원장 2026-09-22) — 신규문의·전일 입테 팝업과 입학 일정 줄이 상담 id로 같은 표를 읽는다.
    <ConsultChipsProvider chips={v.consultProgress?.data?.chips ?? null}>
    <div className={appearance.dashboard}>
    <div className={s.root} data-overview="root">
      <div className={s.board} data-overview="board">
        <header className={s.header} data-overview="header">
          <div className={s.identity}>
            <span className={s.eyebrow}>
              {snapshot.academy || "에이와"} · ACADEMY OVERVIEW
            </span>
            <h1>
              {/* 과목 관리자 = 맨 위 제목 한 곳에 담당 과목(원장 2026-10-01 `학원 전체 현황 (수학)`) — 카드·숫자 라벨은 원래 이름 그대로. */}
              학원 전체 현황{view?.scopeLabel ? ` (${view.scopeLabel})` : ""}<span>{snapshot.today.replaceAll("-", ".")}</span>
            </h1>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static 19KB pre-rendered artwork */}
          <img className={appearance.headerArtwork} src="/previews/dashboard/study.webp" width="96" height="64" alt="" aria-hidden />
          <div className={s.headerTools}>
            {demoRoster ? <DemoRosterSwitch control={demoRoster} /> : null}
            {onSwitchDesign ? (
              <button type="button" className={s.designSwitch} onClick={onSwitchDesign} onPointerEnter={onPreloadDesign} onFocus={onPreloadDesign}>
                대시보드 전환
              </button>
            ) : null}
            <div
              className={s.freshness}
              title="표시 시각은 에이와 DB 조회 시각입니다. 외부 서비스의 동기화 완료 시각과는 다릅니다."
            >
              <i className={failed ? s.dotWarning : s.dotLive} />
              <span>
                {preview
                  ? "미리보기"
                  : hydrated && query.isFetching
                  ? "최신 정보 확인 중"
                  : failed
                    ? "일부 정보 갱신 필요"
                    : "자동 갱신"}
                <small>
                  {lastTime.length
                    ? `${clock(Math.min(...lastTime))} 확인${preview ? "" : " · 5분 주기"}`
                    : "조회 대기"}
                </small>
              </span>
            </div>
            {preview ? null : (
            <button
              className={s.refresh}
              type="button"
              onClick={() => void query.refetch({ cancelRefetch: false })}
              disabled={hydrated && query.isFetching}
              aria-label="전체 정보 새로고침"
            >
              <EyIcon
                name="sync"
                size={17}
                className={hydrated && query.isFetching ? s.spinning : ""}
              />
            </button>
            )}
          </div>
        </header>

        {!preview && (view?.subjectChoices?.length ?? 0) > 1 ? <nav className="mb-4 flex flex-wrap gap-2" aria-label="대시보드 과목">
          {view!.subjectChoices!.map((choice) => <Link key={choice.key} href={`/dashboard?subject=${encodeURIComponent(choice.key)}`}
            aria-current={view?.activeSubject === choice.key ? "page" : undefined}
            className={`rounded-md border px-3 py-1 text-sm ${view?.activeSubject === choice.key ? "bg-primary text-primary-foreground" : "bg-background"}`}>{choice.label}</Link>)}
        </nav> : null}

        {classic ? (
          <>
            {/* KPI 여덟 칸(원장 2026-09-11 여섯 칸 → 보강예정 → 2026-09-23 금일 등록) — 카드 = 팝업, ↗ = 목적지 창. 카드·팝업·목적지가 같은 함수를 부른다. */}
            <KpiStrip snapshot={snapshot} only={classic.kpis} />
            {classic.sections.map((section) => (
              <Fragment key={section.id}>
                {section.title ? (
                  <div id={section.id} className={s.sectionLine} data-dashboard-card={`heading:${section.id}`}>
                    <span>{section.title}</span>
                    <p>{section.note}</p>
                  </div>
                ) : null}
                <div className={s.grid} data-overview="grid">
                  {section.panels.map((slot) => <Fragment key={slot}>{slot === "followup" ? followup : panels[slot]}</Fragment>)}
                </div>
              </Fragment>
            ))}
          </>
        ) : (
          // 역할·과목별 배치 — 저장한 행·열과 크기를 유지한다.
          <GridBoard
            items={view?.items ?? []}
            snapshot={snapshot}
            panels={panels}
            kpis={kpiCards(snapshot, { titles: Object.fromEntries(custom), academyWide: [...academyWide] }).cards}
          />
        )}
        <footer className={s.footer}>
          <span>에이와 / OVERVIEW</span>
        </footer>
      </div>
    </div>
    </div>
    </ConsultChipsProvider>
  );
}

/** 강사별 업무 현황 머리 안내 — 기능이 꺼진 지점엔 그 줄의 기간도 적지 않는다(카드의 표시 여부와 같은 값). */
function teacherWorkNote(data: { deliveryShown?: boolean; counselShown?: boolean; to?: string; counselMonth?: string | null } | null | undefined): string {
  return ["현재 담당 반", "보고서·영상 숙제 최근 7일", "출결 어제까지 7일",
    ...(data?.deliveryShown === true ? ["학부모 미확인 최근 30일"] : []),
    ...(data?.counselShown === true ? [`원생상담 ${counselPeriodLabel(data.counselMonth, data.to ?? "")}`] : [])].join(" · ");
}
