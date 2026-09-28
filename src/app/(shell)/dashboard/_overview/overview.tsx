"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import {
  processingSummary,
  type OverviewSnapshot,
  type Section,
} from "@/features/dashboard/overview/model";
import { concurrentShare } from "@/features/students/enrolled-composition";
// 재원생 패널 ↗는 KPI 카드와 같은 주소 — "/students"만 적으면 계정에 저장된 필터가 끼어 숫자가 달라 보인다(F21).
import { studentsEnrolledHref } from "@/features/dashboard/overview/kpi-links";
import { DASHBOARD_SUBJECT_COLORS, STAFF_SUBJECT_LEGEND, dashboardSubjectColor, dashboardCombinationColor } from "@/features/dashboard/overview/subject-colors";
import { foldExpenseTotals } from "@/features/dashboard/overview/expense-total";
import { paymentRateDisplay } from "@/features/billing/calc";
import { monthDayLabel } from "@/lib/date-kst";
import { monthAheadNote, monthAheadWindow, windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
import { useOverview } from "./use-overview";
import { DetailPopup } from "./detail-popup";
import { CurrentClasses } from "./current-classes";
import { SchoolDistribution } from "./school-distribution";
import { AdmissionsSchedule } from "./admissions-schedule";
import { KpiStrip } from "./kpi-strip";
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
}) {
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
        {href && (
          <Jump href={href}>
            <span className={s.srOnly}>{title} </span>상세
          </Jump>
        )}
      </header>
      <div className={s.panelBody}>
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
}: {
  initial: OverviewSnapshot;
  /** 데모 지점 원장에게만. 다른 지점은 null이라 버튼이 없다. */
  demoRoster?: DemoRosterControl | null;
}) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const query = useOverview(initial);
  const snapshot = query.data;
  const v = snapshot.sections;
  const student = v.students?.data;
  const change = v.changes?.data;
  const currentChange = change?.at(-1);
  const billing = v.billing?.data;
  const bill = billing?.at(-1);
  const attendance = v.attendance?.data;
  const processing = v.processing?.data
    ? processingSummary(v.processing.data)
    : null;
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
  const delta = currentChange
    ? currentChange.enrolled - currentChange.withdrawn
    : null;

  return (
    // 콜&상담 진행 칩(원장 2026-09-22) — 신규문의·금일입테 팝업과 입학 일정 줄이 상담 id로 같은 표를 읽는다.
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
              학원 전체 현황<span>{snapshot.today.replaceAll("-", ".")}</span>
            </h1>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static 19KB pre-rendered artwork */}
          <img className={appearance.headerArtwork} src="/previews/dashboard/study.webp" width="96" height="64" alt="" aria-hidden />
          <div className={s.headerTools}>
            {demoRoster ? <DemoRosterSwitch control={demoRoster} /> : null}
            {snapshot.allowed.includes("timetable") && snapshot.allowed.includes("classes") && (
                <Jump href="/dashboard?view=rooms" className={s.classroomPreview}>
                  강의실 2D/3D
                </Jump>
              )}
            <div
              className={s.freshness}
              title="표시 시각은 에이와 DB 조회 시각입니다. 외부 서비스의 동기화 완료 시각과는 다릅니다."
            >
              <i className={failed ? s.dotWarning : s.dotLive} />
              <span>
                {hydrated && query.isFetching
                  ? "최신 정보 확인 중"
                  : failed
                    ? "일부 정보 갱신 필요"
                    : "자동 갱신"}
                <small>
                  {lastTime.length
                    ? `${clock(Math.min(...lastTime))} 확인 · 30초 주기`
                    : "조회 대기"}
                </small>
              </span>
            </div>
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
          </div>
        </header>

        {/* KPI 여덟 칸(원장 2026-09-11 여섯 칸 → 보강예정 → 2026-09-23 금일 등록) — 카드 = 팝업, ↗ = 목적지 창. 카드·팝업·목적지가 같은 함수를 부른다. */}
        <KpiStrip snapshot={snapshot} />

        <div id="academy-overview" className={s.sectionLine}>
          <span>학원 운영 한눈에</span>
          <p>재원 · 출결 · 수납 · 신규생</p>
        </div>
        <div className={s.grid} data-overview="grid">
          <Panel
            title="재원생 구성"
            note="초·중·고 · 영어·동시수강·수학"
            href={studentsEnrolledHref()}
            sections={[v.students]}
          >
            {student && (student.levelSplit
              ? <LevelSplitChart split={student.levelSplit} noEnrollment={student.programs.noEnrollment} />
              : <Donut data={student.levels} label="전체 재원" />)}
          </Panel>
          {/* 원장 2026-09-13 "출결 현황은 오늘것만 카운팅" — 오늘 기록이 없어도 지난 기록일로 넘어가지 않는다(attendance-day.ts).
              ↗ = 오늘 출결(원장 2026-09-14 "출결 현황 바로가기를 오늘의 출결과 연결") — 카드가 오늘만 세니 목적지도 오늘 화면.
              게이트는 월별과 같은 `attendance` 키라 숨김 조건이 따로 없다. 14일 추이(아래 '최근 14일 등원율')는 월별 그대로. */}
          <Panel
            title="출결 현황"
            note="오늘 · 학생·반·교시별 출결 칸"
            href="/attendance/live"
            sections={[v.attendance, v.processing]}
          >
            {attendance ? (
              <Donut
                data={[
                  {
                    label: "출석",
                    value: attendance.present,
                    color: COLORS[2],
                  },
                  { label: "결석", value: attendance.absent, color: "#bc3838" },
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
                  : "오늘 출결 기록이 아직 없습니다."}
              </p>
            )}
            {processing && (
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
          <Panel
            title={`${thisMonth} 수납 현황`}
            note="당월 청구서 · 취소 청구 제외"
            href={`/billing?period=${snapshot.today.slice(0, 7)}`}
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
                      color: "#bc3838",
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
                  <InlineStat
                    label="미수 잔액"
                    value={
                      <span title={`${number(bill.outstanding)}원`}>
                        {bill.outstanding < 10_000 ? `${number(bill.outstanding)}원` : money(bill.outstanding)}
                      </span>
                    }
                    danger={bill.outstanding > 0}
                  />
                </div>
              </>
            )}
          </Panel>
          <Panel
            title="신규생 단계별 관리"
            note="등록 후 90일 · 재원·휴원 학생"
            href="/newcomers"
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
          <Panel
            title="등록 · 퇴원 추이"
            note="최근 6개월 · 당월은 오늘까지"
            href="/students"
            sections={[v.changes]}
            wide
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
          <Panel
            title="6개월 청구 · 수납"
            note="최근 6개월 · 청구월 기준 실청구액(청구 − 할인)"
            href="/billing"
            sections={[v.billing]}
            wide
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
        </div>

        <div id="student-overview" className={s.sectionLine}>
          <span>학생 · 학습 · 상담</span>
          <p>학생 구성과 학습·상담 신호</p>
        </div>
        <div className={s.grid} data-overview="grid">
          <Panel
            title="과목별 수강"
            note="재원생 · 과목별 수강과 동시 수강"
            href={studentsEnrolledHref()}
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
          <Panel
            title="학년별 재원생"
            note="학원설정 학년 순 · 영어·수학 수강 구성"
            href={studentsEnrolledHref()}
            sections={[v.students]}
          >
            {student && <GradeSplitChart split={student.gradeSplit} noEnrollment={student.programs.noEnrollment} />}
          </Panel>
          <Panel
            title="학교별 학생"
            note="재원생 · 초등·중등·고등"
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
          <Panel
            title="콜&상담 전환"
            note="지난달 · 이번 달 접수 기준"
            sections={[v.admissions]}
          >
            {admissions && <AdmissionsComparison stats={admissions} today={snapshot.today} />}
          </Panel>
          <Panel
            title="상담 진행"
            note={
              v.consultProgress?.data
                ? `상담일 기준 ${monthDayLabel(v.consultProgress.data.summary.from)}부터 · 접수 → 수업 시작`
                : "상담일 기준 최근 30일 · 접수 → 수업 시작"
            }
            href="/enrollment"
            sections={[v.consultProgress]}
          >
            {v.consultProgress?.data && <ConsultProgressBody data={v.consultProgress.data} subjects={snapshot.subjects} />}
          </Panel>
          <Panel
            title="최근 14일 등원율"
            note="(출석 + 지각) / 유효 출결 칸"
            href="/attendance"
            sections={[v.attendanceTrend]}
          >
            {v.attendanceTrend?.data && (
              <>
                <AttendanceHistory points={v.attendanceTrend.data} />
              </>
            )}
          </Panel>
          <Panel
            id="repeated-absences"
            title="반복 결석 학생"
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
                <div className={s.riskNames}>
                  {v.absences.data.rows.slice(0, 6).map((row) => (
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
                {v.absences.data.rows.length > 6 && (
                  <DetailPopup
                    title="반복 결석 학생"
                    label={`전체 ${v.absences.data.rows.length}명 보기`}
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
          {(v.homework || v.unread || v.consultations) && (
            <div className={s.followupPanels}>
              <Panel
                title="학습 · 학부모 보고"
                note={
                  homework
                    ? `최근 ${homework.windowDays}일 숙제 · ${subjects(homework.subjects)}`
                    : "수업보고서 기준"
                }
                href="/lesson-reports?tab=list"
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
                          color: "#bc3838",
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
              <Panel
                title="학생 상담"
                note="전체 상담 기록 · 후속조치"
                href="/consultations"
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
                          color: "#bc3838",
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
                        전체 기록 <b>{number(consultations.total)}건</b>
                      </span>
                      <Jump href="/consultations?urg=overdue">후속조치 확인</Jump>
                    </div>
                  </>
                )}
              </Panel>
            </div>
          )}
        </div>

        <div id="operations-overview" className={s.sectionLine}>
          <span>수업과 학원 운영</span>
          <p>신규생 체크 · 강사 시트 · 일정과 행정</p>
        </div>
        <div className={s.grid} data-overview="grid">
          <Panel
            title="신규생 체크 진행"
            note="필수 6항목 · 2개월 콜은 선택"
            href="/newcomers"
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
                          ? `확인 필요: ${item.needs.map((p) => p.name).join(", ")}`
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
                            color: "#bc3838",
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
                    { label: "기한 경과", color: "#bc3838" },
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
          <Panel
            title="강사 시트 작성 현황"
            note="현재 시트의 기간·보기 필터 기준"
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
          <Panel
            title="현재 수업 현황"
            helpKey="dash-now"
            note={
              v.schedule?.at
                ? `${clock(v.schedule.at)} 기준 · 과목별`
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
          <Panel
            title="레벨테스트 및 첫수업 일정"
            note={monthAheadNote(admissionsRange)}
            sections={[v.calendar]}
          >
            <AdmissionsSchedule events={v.calendar?.data ?? []} limit={3} />
            {v.calendar?.data?.length === 0 && (
              <p className={s.empty}>
                오늘부터 {windowUntilLabel(admissionsRange)} 레벨테스트·첫 수업 일정이 없습니다.
              </p>
            )}
            {(["levelTest", "firstClass"] as const).some((kind) => (v.calendar?.data?.filter((event) => event.kind === kind).length ?? 0) > 3) && (
              <DetailPopup
                title="레벨테스트 및 첫수업 일정"
                label={`전체 ${v.calendar!.data!.length}개 일정 보기`}
              >
                <AdmissionsSchedule events={v.calendar!.data!} />
              </DetailPopup>
            )}
          </Panel>
          <Panel
            title="직원 구성"
            note="재직 중 · 운영 역할 기준"
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
          <Panel
            title="행정 · 자산"
            note="열람 가능한 업무 기준"
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
          <Panel
            title={`${thisMonth} 지출 내역`}
            note={
              v.expenses?.data
                ? `지출일 기준 · ${v.expenses.data.count}건`
                : "당월 지출결의서 기준"
            }
            href={`/billing?tab=expenses&period=${snapshot.today.slice(0, 7)}`}
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
          <Panel
            title="학원 공지"
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
        </div>

        <footer className={s.footer}>
          <span>에이와 / OVERVIEW</span>
        </footer>
      </div>
    </div>
    </div>
    </ConsultChipsProvider>
  );
}
