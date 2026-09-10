"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { WindowLink } from "@/components/workspace/window-link";
import { paymentRateDisplay } from "@/features/billing/calc";
import {
  processingSummary,
  type OverviewSnapshot,
  type Section,
} from "@/features/dashboard/overview/model";
import { useOverview } from "./use-overview";
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
} from "./charts";
import s from "./overview.module.css";

const clock = (at: number) =>
  new Date(at).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const shortDate = (date: string) => date.slice(5).replace("-", "/");
const monthLabel = (month: string) => `${Number(month.slice(5))}월`;

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
  title,
  note,
  href,
  sections,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  note: string;
  href?: string;
  sections: (Section<unknown> | undefined)[];
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const visible = sections.filter((v) => !!v);
  if (!visible.length) return null;
  const failed = visible.some((v) => v.error);
  const times = visible.flatMap((v) => (v.at === null ? [] : [v.at]));
  const available = times.length > 0;
  return (
    <section
      className={`${s.panel} ${wide ? s.wide : ""} ${className}`}
      aria-label={title}
    >
      <header className={s.panelHeader}>
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
          {available
            ? `일부 갱신 실패 · ${clock(Math.min(...times))} 확인값 포함`
            : "조회 실패 · 0건을 의미하지 않습니다"}
        </p>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  unit,
  detail,
  icon,
  href,
  error,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon: ReactNode;
  href: string;
  error?: boolean;
}) {
  return (
    <WindowLink
      href={href}
      className={s.kpi}
      ariaLabel={`${label} ${value}${unit ?? ""}. ${detail}`}
    >
      <div className={s.kpiLabel}>
        {icon}
        <span>{label}</span>
        <OpenIcon size={14} />
      </div>
      <div className={s.kpiValue}>
        {value}
        <span>{unit}</span>
      </div>
      <p className={error ? s.textDanger : undefined}>
        {error
          ? value === "—"
            ? "조회 실패 · 다시 확인 필요"
            : "갱신 실패 · 이전 확인값"
          : detail}
      </p>
    </WindowLink>
  );
}

function InlineStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={s.inlineStat}>
      <span>{label}</span>
      <strong className={danger ? s.textDanger : undefined}>{value}</strong>
    </div>
  );
}

export function Overview({ initial }: { initial: OverviewSnapshot }) {
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
  const nextSchedule = schedule?.filter((slot) => slot.status !== "done");
  const visibleSchedule = nextSchedule?.length
    ? nextSchedule.slice(0, 5)
    : schedule?.slice(-5);
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
  const careDue = care?.checksAvailable
    ? care.items
        .filter((i) => !i.optional)
        .reduce((sum, i) => sum + i.overdue + i.due, 0)
    : null;
  const classData = v.classes?.data;
  const carePeople = care?.checksAvailable
    ? new Set(
        care.items
          .filter((item) => !item.optional)
          .flatMap((item) => item.needs.map((p) => p.id)),
      ).size
    : null;
  const staff = v.staff?.data;
  const thisMonth = monthLabel(snapshot.today.slice(0, 7));
  const delta = currentChange
    ? currentChange.enrolled - currentChange.withdrawn
    : null;
  const entrySeries = admissions
    ? [
        { label: "등록", value: admissions.enrolled, color: COLORS[2] },
        {
          label: "진행",
          value: admissions.months.reduce((sum, m) => sum + m.open, 0),
          color: COLORS[0],
        },
        {
          label: "미등록",
          value: admissions.months.reduce((sum, m) => sum + m.declined, 0),
          color: COLORS[3],
        },
        {
          label: "미방문",
          value: admissions.months.reduce((sum, m) => sum + m.noShow, 0),
          color: COLORS[5],
        },
      ]
    : [];

  return (
    <div className={s.root}>
      <div className={s.board}>
        <header className={s.header}>
          <div className={s.identity}>
            <span className={s.eyebrow}>
              {snapshot.academy || "EYWA"} · ACADEMY OVERVIEW
            </span>
            <h1>
              학원 전체 현황<span>{snapshot.today.replaceAll("-", ".")}</span>
            </h1>
          </div>
          <div className={s.headerTools}>
            <div
              className={s.freshness}
              title="표시 시각은 eywa DB 조회 시각입니다. 외부 서비스의 동기화 완료 시각과는 다릅니다."
            >
              <i className={failed ? s.dotWarning : s.dotLive} />
              <span>
                {query.isFetching
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
              disabled={query.isFetching}
              aria-label="전체 정보 새로고침"
            >
              <EyIcon
                name="sync"
                size={17}
                className={query.isFetching ? s.spinning : ""}
              />
            </button>
            <Jump href="/dashboard/briefing" className={s.briefingLink}>
              일일 브리핑
            </Jump>
          </div>
        </header>

        <div className={s.kpis}>
          {v.students && (
            <Kpi
              label="전체 재원생"
              value={student ? number(student.enrolled) : "—"}
              unit="명"
              detail={
                delta === null
                  ? "현재 재원 상태 기준"
                  : `${thisMonth} 등록 ${currentChange!.enrolled} · 퇴원 ${currentChange!.withdrawn} · 순증 ${delta > 0 ? "+" : ""}${delta}`
              }
              icon={<MenuGlyph name="users" size={20} />}
              href="/students"
              error={v.students.error}
            />
          )}
          {v.classes && (
            <Kpi
              label="운영 중 수업"
              value={classData ? number(classData.active) : "—"}
              unit="반"
              detail={
                schedule
                  ? `오늘 ${schedule.length}개 시간대 · 진행 중 ${schedule.filter((r) => r.status === "ongoing").length}`
                  : "수업목록 운영 상태 기준"
              }
              icon={<MenuGlyph name="book" size={20} />}
              href="/classes"
              error={v.classes.error}
            />
          )}
          {v.processing && (
            <Kpi
              label="오늘 출결 입력"
              value={processing ? number(processing.recorded) : "—"}
              unit={processing ? `/ ${number(processing.expected)}` : ""}
              detail={
                processing
                  ? `완료 ${processing.complete}반 · 입력 중 ${processing.partial}반 · 미기록 ${processing.unmarked}반`
                  : "출결 정보 확인 필요"
              }
              icon={<MenuGlyph name="clipboardCheck" size={20} />}
              href="/attendance"
              error={v.processing.error}
            />
          )}
          {v.billing && (
            <Kpi
              label={`${thisMonth} 수납률`}
              value={
                bill?.totalCount
                  ? paymentRateDisplay(bill.paymentRate, bill.outstanding)
                  : "—"
              }
              unit={bill?.totalCount ? "%" : ""}
              detail={
                bill
                  ? bill.totalCount
                    ? `수납 ${money(bill.totalCollected)} · 미수 ${money(bill.outstanding)}`
                    : "이번 달 청구서 없음"
                  : "수납 정보 확인 필요"
              }
              icon={<MenuGlyph name="wallet" size={20} />}
              href={`/billing?period=${snapshot.today.slice(0, 7)}`}
              error={v.billing.error}
            />
          )}
          {v.newcomers && (
            <Kpi
              label="신규생 90일 관리"
              value={care ? number(care.total) : "—"}
              unit="명"
              detail={
                careDue === null
                  ? "체크리스트 연결 확인 필요"
                  : `확인 필요 ${carePeople}명 · 필수 체크 ${careDue}건`
              }
              icon={<MenuGlyph name="userPlus" size={20} />}
              href="/newcomers"
              error={v.newcomers.error}
            />
          )}
        </div>

        <div id="academy-overview" className={s.sectionLine}>
          <span>학원 운영 한눈에</span>
          <p>재원 · 출결 · 수납 · 신규생</p>
        </div>
        <div className={s.grid}>
          <Panel
            title="재원생 구성"
            note="급간별 · 재원 상태 학생"
            href="/students"
            sections={[v.students]}
          >
            {student && <Donut data={student.levels} label="전체 재원" />}
          </Panel>
          <Panel
            title="출결 현황"
            note={
              attendance
                ? `${attendance.date === snapshot.today ? "오늘" : `최근 기록 ${shortDate(attendance.date)}`} · 학생·반·교시별 출결 칸`
                : "출결 기록 기준"
            }
            href="/attendance"
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
                  : "등록된 출결 기록이 없습니다."}
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
                <p className={s.footnote}>
                  입력 진행률은 반별 예정학생 기준이며, 위 출결은 교시마다 별도
                  집계합니다.
                </p>
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
                <div className={s.separated}>
                  <InlineStat
                    label="미수 잔액"
                    value={money(bill.outstanding)}
                    danger={bill.outstanding > 0}
                  />
                </div>
                <p
                  className={s.footnote}
                  title={`${number(bill.outstanding)}원`}
                >
                  미수 {number(bill.outstanding)}원 · 청구−할인−납부, 상태 반영
                </p>
              </>
            )}
          </Panel>
          <Panel
            title="신규생 단계별 관리"
            note="등록 후 90일 · 재원·대기 학생"
            href="/newcomers"
            sections={[v.newcomers]}
          >
            {care && (
              <>
                <Bars
                  data={care.stages.filter(
                    (r) => r.value > 0 || r.label !== "90일 초과",
                  )}
                  color={COLORS[2]}
                />
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
                  <span>처리일 기준 · 날짜 미상 시스템 정리 제외</span>
                </div>
                <Columns
                  labels={change.map((r) => monthLabel(r.month))}
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
            title="월별 청구 · 수납"
            note="최근 6개월 · 청구월 기준 누적 금액"
            href="/billing"
            sections={[v.billing]}
            wide
          >
            {billing && (
              <>
                <Columns
                  labels={billing.map((r) => monthLabel(r.period))}
                  series={[
                    {
                      name: "실청구",
                      color: "#b3c3d7",
                      values: billing.map(
                        (r) => r.totalBilled - r.totalDiscount,
                      ),
                    },
                    {
                      name: "수납",
                      color: COLORS[0],
                      values: billing.map((r) => r.totalCollected),
                    },
                  ]}
                  unit="원"
                  format={(n) => number(Math.round(n / 10_000))}
                  valueLabels="last"
                />
                <p className={s.footnote}>
                  세로축 만원 · 실청구 = 청구액−할인액 · 입금일별 매출과
                  다릅니다.
                </p>
              </>
            )}
          </Panel>
        </div>

        <div id="student-overview" className={s.sectionLine}>
          <span>학생 · 학습 · 상담</span>
          <p>학생 구성과 학습·상담 신호</p>
        </div>
        <div className={s.grid}>
          <Panel
            title="과목별 수강"
            note="과목 안에서 학생 중복 제거"
            href="/students"
            sections={[v.students]}
          >
            {student && (
              <>
                <Bars
                  data={student.subjects.map((r, i) => ({
                    ...r,
                    label: snapshot.subjects[r.label] ?? r.label,
                    color: COLORS[i % COLORS.length],
                  }))}
                  limit={6}
                />
                <p className={s.footnote}>
                  여러 과목을 수강하면 각 과목에 포함됩니다.
                </p>
              </>
            )}
          </Panel>
          <Panel
            title="학년별 학생"
            note="재원생 전체 · 미입력 포함"
            href="/students"
            sections={[v.students]}
          >
            {student && (
              <Bars data={student.grades} limit={7} color={COLORS[1]} />
            )}
          </Panel>
          <Panel
            title="학교별 학생"
            note="재원생 · 상위 6개 학교"
            href="/students"
            sections={[v.students]}
          >
            {student && <Bars data={student.schools} limit={6} />}
          </Panel>
          <Panel
            title="등록 상담 전환"
            note={`${snapshot.today.slice(0, 4)}년 상담 접수 기준`}
            href="/enrollment?view=stats"
            sections={[v.admissions]}
          >
            {admissions && (
              <>
                <div className={s.chartHeadline}>
                  <b>
                    등록 전환율{" "}
                    <strong>
                      {admissions.rate === null
                        ? "—"
                        : `${admissions.rate.toFixed(1)}%`}
                    </strong>
                  </b>
                  <span>접수 {number(admissions.total)}건</span>
                </div>
                <Bars data={entrySeries} unit="건" />
                <p className={s.footnote}>
                  등록 {number(admissions.enrolled)}건 / 전체 접수{" "}
                  {number(admissions.total)}건
                </p>
              </>
            )}
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
                <p className={s.footnote}>
                  기록 없는 날은 비워 둡니다. 오늘 수치는 입력에 따라 바뀝니다.
                </p>
              </>
            )}
          </Panel>
          <Panel
            title="반복 결석 학생"
            note={
              v.absences?.data?.anchor
                ? `${shortDate(v.absences.data.anchor)}까지 14일 · 사전 통보 제외 3칸 이상`
                : "최근 14일 · 사전 통보 제외"
            }
            href="/attendance"
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
                    <div key={row.studentId}>
                      <span>{row.studentName}</span>
                      <b>
                        {row.unexplained}
                        <small>칸</small>
                      </b>
                    </div>
                  ))}
                </div>
                {v.absences.data.rows.length > 6 && (
                  <details className={s.details}>
                    <summary>전체 {v.absences.data.rows.length}명 보기</summary>
                    <div className={s.riskNames}>
                      {v.absences.data.rows.slice(6).map((row) => (
                        <div key={row.studentId}>
                          <span>{row.studentName}</span>
                          <b>
                            {row.unexplained}
                            <small>칸</small>
                          </b>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {v.absences.data.rows.length === 0 && (
                  <p className={s.footnote}>
                    이 기준에 해당하는 학생이 없습니다.
                  </p>
                )}
              </>
            )}
          </Panel>
          <Panel
            title="학습 · 학부모 보고"
            note={
              homework
                ? `최근 ${homework.windowDays}일 숙제 · ${subjects(homework.subjects)}`
                : "수업보고서 기준"
            }
            href="/lesson-reports"
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
                <p className={s.footnote}>
                  두 항목에 중복 포함 가능 · 판정 제외 {homework.unparsed}건
                </p>
              </>
            )}
            {unread && (
              <div className={s.separated}>
                <InlineStat
                  label={`발송 ${unread.graceHours}시간 후 미확인`}
                  value={
                    <>
                      {number(unread.reports)}
                      <small>건</small>
                    </>
                  }
                />
                <p className={s.footnote}>
                  최근 {unread.windowDays}일 · {subjects(unread.subjects)} ·
                  읽음 동기화 대상
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

        <div id="operations-overview" className={s.sectionLine}>
          <span>수업과 학원 운영</span>
          <p>신규생 체크 · 강사 시트 · 일정과 행정</p>
        </div>
        <div className={s.grid}>
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
                  <details className={s.details}>
                    <summary>확인이 필요한 학생 {carePeople}명</summary>
                    {care.items
                      .filter((item) => !item.optional && item.needs.length)
                      .map((item) => (
                        <p key={item.label}>
                          <b>{item.label}</b> ·{" "}
                          {item.needs.map((p) => p.name).join(", ")}
                        </p>
                      ))}
                  </details>
                )}
              </>
            ) : (
              <p className={s.empty}>체크리스트 연결 확인이 필요합니다.</p>
            )}
          </Panel>
          <Panel
            title="강사 시트 작성 현황"
            note="현재 시트의 기간·보기 필터 기준"
            href={snapshot.allowed.includes("ecs") ? "/ecs" : "/mcs"}
            sections={[v.englishSheet, v.mathSheet]}
          >
            {(
              [
                {
                  section: v.englishSheet,
                  label: "영어",
                  href: "/ecs",
                  unit: "교시",
                },
                {
                  section: v.mathSheet,
                  label: "수학",
                  href: "/mcs",
                  unit: "학생·수업일",
                },
              ] as const
            )
              .filter((row) => row.section)
              .map(({ section, label, href, unit }) => (
                <div className={s.sheetSummary} key={label}>
                  <div>
                    <Jump href={href}>{label} 시트</Jump>
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
                            color: COLORS[0],
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
            title="오늘 수업 일정"
            note={
              schedule
                ? `${schedule.length}개 시간대 · ${nextSchedule?.length ? "진행·예정 수업 우선" : "마지막 수업부터 확인"}`
                : "오늘 시간표"
            }
            href="/timetable"
            sections={[v.schedule]}
          >
            {schedule && (
              <>
                <div className={s.schedule}>
                  {visibleSchedule?.map((slot) => (
                    <WindowLink
                      href={`/classes/${slot.classId}`}
                      key={slot.id}
                      className={s.scheduleRow}
                    >
                      <time>
                        {slot.startTime.slice(0, 5)}
                        <small>{slot.endTime.slice(0, 5)}</small>
                      </time>
                      <i
                        className={
                          slot.status === "ongoing"
                            ? s.scheduleLive
                            : slot.status === "done"
                              ? s.scheduleDone
                              : s.scheduleSoon
                        }
                      />
                      <span>
                        <b>{slot.className}</b>
                        <small>
                          {slot.teacherName ?? "강사 미정"} ·{" "}
                          {slot.classroomName ?? "교실 미정"}
                        </small>
                      </span>
                      <em>
                        {slot.status === "ongoing"
                          ? "진행"
                          : slot.status === "done"
                            ? "종료"
                            : "예정"}
                      </em>
                    </WindowLink>
                  ))}
                </div>
                {schedule.length === 0 && (
                  <p className={s.empty}>오늘 예정된 수업이 없습니다.</p>
                )}
                {schedule.length > 5 && (
                  <Jump href="/timetable">
                    전체 {schedule.length}개 시간대 보기
                  </Jump>
                )}
              </>
            )}
          </Panel>
          <Panel
            title="다가오는 학원 일정"
            note="오늘부터 7일 · 취소·예약 차단·근무 일정 제외"
            sections={[v.calendar]}
          >
            <div className={s.notices}>
              {v.calendar?.data?.slice(0, 6).map((event) => (
                <div key={event.id} className={s.calendarEvent}>
                  <time>
                    {shortDate(event.startDate)}
                    <small>{event.startTime?.slice(0, 5) ?? "종일"}</small>
                  </time>
                  <span>{event.title}</span>
                </div>
              ))}
            </div>
            {v.calendar?.data?.length === 0 && (
              <p className={s.empty}>다가오는 7일간 일정이 없습니다.</p>
            )}
            {(v.calendar?.data?.length ?? 0) > 6 && (
              <details className={s.details}>
                <summary>전체 {v.calendar!.data!.length}개 일정 보기</summary>
                {v.calendar!.data!.slice(6).map((event) => (
                  <div key={event.id} className={s.calendarEvent}>
                    <time>
                      {shortDate(event.startDate)}
                      <small>{event.startTime?.slice(0, 5) ?? "종일"}</small>
                    </time>
                    <span>{event.title}</span>
                  </div>
                ))}
              </details>
            )}
          </Panel>
          <Panel
            title="직원 구성"
            note="재직 중 · 시스템 역할 기준"
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
                <Bars data={staff} limit={5} color={COLORS[1]} />
              </>
            )}
          </Panel>
          <Panel
            title="행정 · 자산"
            note="열람 가능한 업무 기준"
            href="/menu"
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
                ? `지출일 기준 · ${v.expenses.data.count}건 · ${v.expenses.data.primaryCurrency}`
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
                  unit={v.expenses.data.primaryCurrency}
                  color={COLORS[3]}
                  limit={5}
                />
                <div className={s.separated}>
                  {v.expenses.data.byCurrency.map((c) => (
                    <InlineStat
                      key={c.currency}
                      label={`${c.currency} 지출 합계`}
                      value={
                        c.currency === "KRW"
                          ? money(c.total)
                          : `${number(c.total)} ${c.currency}`
                      }
                    />
                  ))}
                </div>
                {v.expenses.data.count === 0 && (
                  <p className={s.empty}>이번 달 지출 내역이 없습니다.</p>
                )}
                <p className={s.footnote}>
                  분류별 막대는 주 통화 기준 · 서로 다른 통화는 별도 합산
                </p>
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
                <details key={notice.id}>
                  <summary>
                    <span>
                      {notice.pinned && <em>고정</em>}
                      {notice.title}
                    </span>
                    <time>{shortDate(notice.createdAt.slice(0, 10))}</time>
                  </summary>
                  <p>{notice.content}</p>
                </details>
              ))}
            </div>
            {v.notices?.data?.length === 0 && (
              <p className={s.empty}>등록된 공지가 없습니다.</p>
            )}
            <Jump href="/dashboard/announcements">공지 관리 열기</Jump>
          </Panel>
        </div>

        <footer className={s.footer}>
          <span>
            수치는 eywa에 저장된 데이터를 기준으로 자동 갱신됩니다. 외부 연동
            정보는 해당 서비스의 동기화 후 반영됩니다.
          </span>
          <span>EYWA / OVERVIEW</span>
        </footer>
      </div>
    </div>
  );
}
