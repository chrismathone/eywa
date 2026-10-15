/**
 * 직원 포트폴리오 — 스냅샷 하나로 강사 × 최근 7개월의 점수와 근거를 만든다(순수 함수).
 *
 * 🔴 모든 점수는 매월 1일에 새로 시작해 말일에 마감한다. 누적·이월이 없고 전월 점수는 비교에만 쓴다.
 * 🔴 점수 달의 재료는 **지난달 기록**이다(10월 점수 = 9월 실적 · `dataWindowOf` · 원장 2026-10-15) — 줄의 `month`·`partial`(마감)은 점수 달,
 *    `start`·`end`와 근거 날짜는 재료 달. 기록은 점수 달 말일(한국 시간)까지 입력된 것만 본다 — 이후에 보충한 것은 점수를 바꾸지 않는다.
 *    진행 중인 점수 달은 조회 시각까지 인정한다(지난달 기록을 이번 달 안에 늦게 넣어도 센다).
 * 🔴 계산 코드는 지표의 원래 수치(`raw`)와 근거만 낸다 — 몇 점인지·만점·자료 없을 때는 강사평가 설정(`evaluate.ts`)이 정한다.
 *    그래서 근거 문장(`basis`·`reason`)에 배점 숫자를 적지 않는다(화면이 그 달 설정의 규칙 한 줄을 따로 붙인다).
 */
import { subjectLabelRecord } from "@/features/owner/subjects";
import { shiftMonth } from "@/lib/date-kst";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { DEFAULT_CHURN_OPTIONS, DEFAULT_EVALUATION_CONFIG, DEFAULT_REFERRAL_OPTIONS, type EvaluationConfig } from "../evaluation/config";
import { buildChurnModel } from "./churn-model";
import { payRatioItem, type PayResult } from "./pay-ratio";
import { buildContext, type PortfolioContext } from "./context";
import { applyEvaluation, indexEntries, type ManualEntryRow } from "./evaluate";
import { addDays, between, dataWindowOf, daysBetween, kstDateOf, monthWindows, unique } from "./dates";
import { STUDENTS_REASON, followMetric, qualityMetric } from "./metrics";
import { teacherDuties } from "./duties";
import { attendanceItem, reportItem } from "./duty-items";
import { counselItem } from "./counsel";
import { buildReferrals } from "./referrals";
import { applyPreRecord, scoreTotals, type WorkingPeriod } from "./pre-record";
import { deepMathKeyOf } from "./receipt";
import { buildRevenue } from "./revenue";
import { buildSourceItems } from "./source-items";
import { buildStudentTracking } from "./students";
import {
  METRIC_MAX, type ChurnMetric, type Metric, type PayRatioMetric, type PeriodWindow, type PortfolioPeriod, type PortfolioResult, type PortfolioSnapshot,
  type PortfolioTeacher, type SnapshotUser,
} from "./types";
/** 화면 6개월 + 전월 비교용 1개월. */
export const PORTFOLIO_MONTHS = 7;
export type { ManualEntryRow } from "./evaluate";
const GAP_LABEL: Partial<Record<Metric["id"], string>> = { report: "작성 근거 부족", follow: "마감 시점 확인", quality: "평가 기준 확인", students: "배정 기록 확인" };
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const monthNo = (day: string) => Number(day.slice(5, 7));
type Models = {
  ctx: PortfolioContext;
  revenue: ReturnType<typeof buildRevenue>;
  students: ReturnType<typeof buildStudentTracking>;
  churn: (teacherId: string, w: PeriodWindow) => ChurnMetric;
  payRatio: (teacherId: string, month: string) => PayRatioMetric;
  referral: ReturnType<typeof buildReferrals>;
  subjectOf: (classId: string) => string;
  classNameOf: (classId: string) => string;
  /** 성적 관리 · 학부모 만족도 · 강사 근태(`source-items.ts`). */
  sources: ReturnType<typeof buildSourceItems>;
};
function teacherPeriod(d: PortfolioSnapshot, m: Models, user: SnapshotUser, w: PeriodWindow): WorkingPeriod {
  // 점수 달 w · 재료 달 dw(지난달 전체). 기록 인정 시각은 점수 달 기준 — 진행 중이면 조회 시각, 마감한 달이면 그 달 말일.
  const cutoff = w.partial ? (kstDateOf(d.capturedAt) as string) : w.end;
  const dw = dataWindowOf(w);
  const records = m.ctx.recordsAsOf(cutoff);
  const days = daysBetween(dw.start, dw.end);
  const duties = teacherDuties({ d, ctx: m.ctx, records, cutoff, user, days });
  const cells = duties.reportCells;
  const subjectKeys = unique([...duties.classIds].map(m.subjectOf));
  const tracking = m.students.period(user.id, dw);
  const revenue = m.revenue.period(user.id, dw, subjectKeys);
  const coverage = records.coverage.period(user.id, dw);

  const items: Metric[] = [
    reportItem(duties),
    attendanceItem(duties),
    followMetric(d, user, dw, cutoff),
    counselItem({ d, roster: m.students.churnSource.rosterOf, teacherId: user.id, w: dw, classNameOf: m.classNameOf }),
    qualityMetric(d, user, dw),
    {
      id: "students", max: METRIC_MAX.students, value: tracking.value, raw: tracking.adjustment,
      basis: `${monthNo(addDays(dw.start, -1))}월 ${tracking.previous}명 → ${monthNo(dw.start)}월 ${tracking.current}명`,
      reason: STUDENTS_REASON,
      detail: tracking.detail, tracking,
    },
    {
      id: "revenue", max: METRIC_MAX.revenue, value: revenue.value,
      raw: revenue.subjectTotal > 0 ? (100 * revenue.amount) / revenue.subjectTotal : null,
      basis: `담당 ${won(revenue.amount)} / ${revenue.subjectLabel} ${won(revenue.subjectTotal)}`,
      reason: "담당 배분액 ÷ 과목 전체 배분액(%)이 이 항목의 수치입니다. 여러 과목을 맡으면 담당 금액과 해당 과목 전체 금액을 각각 합산합니다. 할인·환불을 반영한 월 수강료를 수강 기간·등원 요일·시간표 시수에 나눴으며, 휴원일·교재·차량비는 제외합니다. 과목은 확인되지만 담당을 연결하지 못한 금액도 그 과목 합계에 포함합니다. 과목 자체를 확인할 수 없는 금액은 별도로 표시합니다.",
      detail: revenue.detail, amount: revenue.amount, subjectTotal: revenue.subjectTotal, subjectLabel: revenue.subjectLabel,
      subjects: revenue.subjects, unassigned: revenue.unassigned, unclassified: revenue.unclassified,
    },
    // 급여 비율은 점수 달 키 — 서버가 재료 달(지난달) 출석부로 낸다(`payDataMonth`).
    m.churn(user.id, dw), m.payRatio(user.id, w.month),
    m.referral(user.id, dw),
    {
      id: "coverage", max: METRIC_MAX.coverage, value: coverage.value, raw: coverage.due ? (100 * coverage.done) / coverage.due : null,
      basis: coverage.due ? `기한 내 완료 ${coverage.done} / 마감 대상 ${coverage.due}건` : `${monthNo(dw.start)}월 마감 대상 없음`,
      reason: `결석 다음 달 같은 날까지 완료한 보강만 인정합니다. 같은 날짜가 없으면 다음 달 말일까지입니다. 기한이 끝나는 달에 한 번 평가합니다. 기한이 남은 건은 감점하지 않습니다. 출석부의 보강 출결·완료 메모·완료 예약을 대조하고, 예정·취소·기한 초과와 중복 기록은 인정하지 않습니다. 대기 ${coverage.pending}건 · 기한 전 완료 ${coverage.early}건${coverage.unconfirmed ? ` · 연결 확인 필요 ${coverage.unconfirmed}건` : ""}.`,
      detail: coverage.detail, due: coverage.due, done: coverage.done, pending: coverage.pending, early: coverage.early,
    },
    ...m.sources(user.id, dw, cutoff, duties.reportTargets, w.month),
  ];
  for (const item of items) if (item.value === null) item.gap = GAP_LABEL[item.id] ?? "근거 확인";

  const cellsOn = (day: string, ...states: string[]) => cells.filter((c) => c.day === day && (!states.length || states.includes(c.state))).length;
  return {
    ...dw, month: w.month, partial: w.partial,
    subjects: subjectKeys,
    classes: [...duties.classIds].map(m.classNameOf).sort(),
    students: tracking.current,
    items,
    ...scoreTotals(items),
    ownReportRecords: d.reports.filter((r) => r.created_by === user.id && between(r.report_date, dw.start, dw.end)
      && (m.ctx.reportCreatedOn.get(r.id) ?? "9999") <= cutoff).length,
    holidays: days.filter((day) => m.ctx.holidays.has(day)),
    dayStats: days.map((day) => ({
      day, holiday: m.ctx.holidays.has(day), target: cellsOn(day), own: cellsOn(day, "own"), proxy: cellsOn(day, "proxy"),
      missing: cellsOn(day, "missing", "late"), late: cellsOn(day, "late"),
    })),
    duty: { report: cells.length + duties.untracked, attendance: duties.attendance.length },
  };
}

/** `duty`는 기록 시작 전 처리에만 쓰는 계산용 값이다 — 저장되는 달에는 싣지 않는다. */
function withoutDuty(w: WorkingPeriod): PortfolioPeriod {
  const period: Partial<WorkingPeriod> = { ...w };
  delete period.duty;
  return period as PortfolioPeriod;
}

/** 계산 창의 가장 오래된 달(전월 비교용 숨은 달). 이보다 앞선 달은 다시 계산하지 않는다. */
export function portfolioFloor(end: string): string {
  return monthWindows(end, PORTFOLIO_MONTHS).at(-1)!.month;
}

/**
 * @param opts.openMonths 아직 마감하지 않은 달(강사 → 달). 지금은 수업 담당이 아닌 강사도 그 달만은 마저 계산한다 —
 *   퇴직·폐강·인계로 대상에서 빠진 날 그 달을 지우면 다음 달 1일에 마감할 행이 없어진다(적대적 리뷰 2026-10-13).
 * @param opts.lastMonths 강사 → 저장된 가장 늦은 달(마감 여부 무관 · `loadLastMonths`). 수업에서 빠진 강사에게 새로 만드는 달은 그 다음 달이
 *   지금 점수 달일 때 그 하나뿐 — 퇴직한 달의 실적 줄(재료 = 지난달 · 2026-10-15).
 */
export function buildPortfolio(d: PortfolioSnapshot, opts: {
  openMonths?: ReadonlyMap<string, readonly string[]>; lastMonths?: ReadonlyMap<string, string>;
  /** 강사평가 설정과 직접 만든 지표의 입력값 · 매출 대비 급여(강사|달 → 비율, 마감하지 않은 달만 — 서버가 출석부로 낸다). */
  evaluation?: { config: EvaluationConfig; entries?: readonly ManualEntryRow[] }; pay?: ReadonlyMap<string, PayResult>;
} = {}): PortfolioResult {
  const ctx = buildContext(d);
  const classes = new Map(d.classes.map((c) => [c.id, c]));
  const labels = subjectLabelRecord(d.settings.subjects as SubjectSetting[]);
  const config = opts.evaluation?.config ?? DEFAULT_EVALUATION_CONFIG;
  const churnOptions = config.metrics.churn.churn ?? DEFAULT_CHURN_OPTIONS;
  // 학생 배정·유지도 강사 탓이 아닌 사유(퇴원율 세는 법의 사유 목록)로 그만둔 것은 감점하지 않는다(원장 2026-10-14 "사유 규칙 적용").
  const students = buildStudentTracking({
    from: d.from, end: d.end, classes: d.classes, schedules: d.schedules, enrollments: d.enrollments, owner: ctx.owner,
    reasons: { studentReasons: d.studentReasons, excludeReasons: churnOptions.excludeReasons, futureEnrollments: d.futureEnrollments },
  });
  // 퇴원율 — 시간표 X 겹침도 이 계산기를 같은 모양으로 부른다(withdrawals/server/exit-overlay.ts · 가드 exit-overlay-wiring.test).
  const entriesOf = indexEntries(opts.evaluation?.entries ?? []);
  const classNameOf = (id: string) => classes.get(id)?.class_name ?? "";
  const churn = buildChurnModel({ source: students.churnSource, classes: d.classes, options: churnOptions, futureEnrollments: d.futureEnrollments, studentReasons: d.studentReasons });
  const models: Models = {
    ctx,
    revenue: buildRevenue({
      classes: d.classes, schedules: d.schedules, enrollments: d.enrollments, invoices: d.invoices, terms: d.terms,
      holidays: ctx.holidays, subjectLabel: (key) => labels[key] ?? key, deepMathKey: deepMathKeyOf(d.settings.subjects), owner: ctx.owner,
    }),
    students,
    churn: (teacherId, w) => ({ id: "churn", max: METRIC_MAX.churn, value: null, ...churn.period(teacherId, w) }),
    payRatio: (teacherId, month) => payRatioItem(opts.pay?.get(`${teacherId}|${month}`)),
    referral: buildReferrals({ referrals: d.referrals ?? [], enrollments: d.enrollments, classes, owner: ctx.owner, options: config.metrics.expansion.referral ?? DEFAULT_REFERRAL_OPTIONS }),
    subjectOf: (id) => classes.get(id)?.subject ?? "",
    classNameOf,
    sources: buildSourceItems(d, {
      classes, owner: ctx.owner, holidays: ctx.holidays, config, entriesOf, classNameOf, classDays: ctx.classDays, rosterOf: students.churnSource.rosterOf,
    }),
  };

  // 수업을 맡는 재직자 — 운영 중인 반의 담임이거나 시간표에 담당으로 적힌 사람.
  const teachingIds = new Set<string>();
  for (const c of d.classes) if (c.is_active && c.teacher_id) teachingIds.add(c.teacher_id);
  for (const s of d.schedules) if (s.teacher_id) teachingIds.add(s.teacher_id);
  const windows = monthWindows(d.end, PORTFOLIO_MONTHS);
  const open = opts.openMonths ?? new Map<string, readonly string[]>();
  const teaching = (u: SnapshotUser) => u.status === "active" && teachingIds.has(u.id);

  const last = opts.lastMonths ?? new Map<string, string>();
  const teachers: PortfolioTeacher[] = d.users
    .filter((u) => teaching(u) || open.has(u.id) || last.has(u.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ko"))
    .flatMap((user) => {
      const monthly = windows.map((w) => teacherPeriod(d, models, user, w));
      if (d.preRecord) applyPreRecord(monthly, d.preRecord);
      for (const w of monthly) applyEvaluation(w, config, entriesOf(user.id, w.month));
      const all = monthly.map(withoutDuty);
      // 수업에서 빠진 강사 = 아직 마감하지 않은 달(학생 수와 상관없이 마감까지) + 저장된 마지막 달의 다음 달이 **지금 점수 달**이면 그 줄(재료 = 그 마지막
      // 달 — 퇴직한 달의 실적 · 그 달에 맡은 반이 있을 때만). 지난 달 줄은 새로 만들지 않는다(출결 수정 기록을 다 못 읽은 채 바로 마감된다 · 재리뷰 2026-10-15).
      const keep = new Set(open.get(user.id) ?? []);
      const next = last.has(user.id) && shiftMonth(last.get(user.id)!, 1) === windows[0].month ? windows[0].month : null;
      const periods = teaching(user) ? (all.some((w) => w.students > 0) ? all : []) : all.filter((w) => keep.has(w.month) || (w.month === next && w.classes.length > 0));
      return periods.length ? [{ id: user.id, name: user.display_name, subjects: user.subjects ?? [], periods }] : [];
    });

  return {
    tenant: d.tenant.name, capturedAt: d.capturedAt, from: d.from, end: d.end, teachers,
    subjectOrder: d.settings.subjects.map((s) => s.key), months: windows.slice(0, PORTFOLIO_MONTHS - 1), preRecord: d.preRecord,
  };
}
