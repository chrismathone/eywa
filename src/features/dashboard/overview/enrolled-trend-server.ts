import "server-only";
import { unstable_cache } from "next/cache";
import { MIX_KEYS, breakdownTrendOf, monthlyPoints, subjectTrendOf, trendOf, weeklyPoints, yearlyPoints, type MixKey, type TrendPoint } from "./enrolled-trend";
import { courseTrendOf } from "./course-trend";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";
import { loadRecordCoverage } from "./record-coverage";
import { clipTrend } from "./trend-points";
import { breakdownFromOf, inputsOf, loadBillingCached, loadTrendRaw, trendInputs, warnBilling, warnCoverage } from "./trend-inputs-server";

/** 두 달 중 늦은 쪽(하나가 없으면 다른 쪽) — 강좌수는 에이와 기록이 갖춰진 달과 수강 기록이 남은 달을 둘 다 지킨다. */
const laterOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
/** 강좌수 자르기 — 실제로 자른 경계가 무엇인지(`cutBy` — 카드 각주가 이유를 맞게 말하게, 적대 재리뷰 2026-10-20). */
function clipCourses(monthly: TrendPoint[], yearly: TrendPoint[], trustFrom: string | null, recordsFrom: string | null): CourseTrend {
  const from = laterOf(trustFrom, recordsFrom);
  const c = clipTrend(monthly, yearly, from);
  return { ...c, cutBy: !c.trustFrom ? null : from === trustFrom ? "trust" : "records" };
}

/** 강좌수 추이(원장 2026-10-20 '강좌수 추이 카드 따로') — 재원생 추이와 같은 날짜·같은 시작 달 규칙(`course-trend.ts`). */
export type CourseTrend = { monthly: TrendPoint[]; yearly: TrendPoint[]; trustFrom: string | null; monthlyFrom: string | null; cutBy?: "trust" | "records" | null };
/**
 * `trustFrom` = 에이와 수강 기록이 갖춰진 첫 달 — 그 전 점을 **실제로 뺐을 때만**(월별 = `monthlyFrom`도) 싣는다(원장 2026-10-20 '2026년 4월부터').
 * `courses` = 같은 원본·같은 날짜로 센 강좌수 추이(운영실 '강좌수 추이' 카드가 읽는다 — 원본을 두 번 읽지 않게 한 캐시에서 함께 센다).
 */
export type EnrolledTrend = { monthly: TrendPoint[]; yearly: TrendPoint[]; recordsFrom: string | null; trustFrom?: string | null; monthlyFrom?: string | null; courses?: CourseTrend };

/**
 * 재원생 추이(월별 12개월 · 연도별) + 강좌수 추이 — 운영실 30초 갱신마다 원본(원생·수강 전건)을 다시 읽지 않게 **센 값을 지점·날짜별 캐시**
 * (B6 — 쿠키 없는 admin client + 신뢰 tenantId 키, `tenant_id` 필터 필수 [[#104]]). 오늘 점이 카드보다 최대 5분 늦을 수 있다.
 * 🔴 캐시 함수 안에서 다른 캐시 함수를 부르지 않는다 — Next는 안쪽 캐시를 건너뛰어(isNestedUnstableCache) 매번 DB로 간다(적대 재리뷰
 *    2026-10-20). 그래서 청구 재료는 **캐시 밖에서 먼저**(자기 5분 캐시 · 실패는 남지 않는다) 받고, 계산값 캐시 안에서는 원본을 직접 읽는다.
 * 청구 재료가 실패하면 키를 바꿔(`fallback`) 1분만 캐시한다 — 정상 키를 대체값으로 더럽히지 않고, 실패가 이어져도 원본은 분당 한 번만
 *    읽으며, 청구가 돌아오면 그 즉시 정상 키(`billed`)로 돌아간다.
 * 연도별은 **퇴원 기록이 있는 첫 해**부터 — 그 전 해는 퇴원이 기록되지 않아 재원생이 부풀어 보인다(실측 첫 퇴원 2025-02).
 * 에이와 수강 기록이 갖춰진 달(`trustFrom`) 전 점은 뺀다(원장 2026-10-20 '2026년 4월부터' — 그 전 달은 실제보다 낮게 나온다).
 */
export async function loadEnrolledTrend(tenantId: string, today: string): Promise<EnrolledTrend> {
  const [billing, coverage] = await Promise.all([loadBillingCached(tenantId, today).catch(warnBilling), loadRecordCoverage(tenantId, today).catch(warnCoverage)]);
  const trustFrom = coverage?.trustFrom ?? null;
  return unstable_cache(
    async () => {
      const raw = await loadTrendRaw(tenantId, today);
      const en = inputsOf(raw, billing, today);
      const months = monthlyPoints(today);
      const years = yearlyPoints(today, raw.fromYear);
      const clipped = clipTrend(trendOf(raw.students, en, months), trendOf(raw.students, en, years), trustFrom);
      // 강좌수는 수강 행에 기댄다 — 수강 종료가 처음 기록된 달 전(그만둔 학생의 수강 행이 없다)도 자른다(과목 선과 같은 경계, 적대 리뷰 2026-10-20).
      const courses = clipCourses(
        courseTrendOf(raw.students, en, raw.enrollments, months, undefined, today),
        courseTrendOf(raw.students, en, raw.enrollments, years, undefined, today),
        trustFrom,
        breakdownFromOf(raw, today),
      );
      return { ...clipped, recordsFrom: raw.recordsFrom, courses };
    },
    ["dashboard-enrolled-trend-v7", tenantId, today, billing ? "billed" : "fallback", trustFrom ?? "-"],
    { revalidate: billing ? 300 : 60 },
  )();
}

/**
 * 과목별 재원생 추이(원장 2026-10-14 2단계) — 과목 관리자 화면·미리보기 원본에서만 부른다. 원생·수강(반 과목 포함) 원본을
 * 지점·날짜별 5분 캐시로 받고(학원 전체 추이와 같은 B6 규약), 묶음마다 `subjectTrendOf`로 센다(판정은 순수 함수 한 벌).
 * 강좌수 추이도 그 과목 반만 함께 센다(`courseTrendOf` — 과목 관리자 '강좌수 추이' 카드).
 */
export async function loadEnrolledTrendSlicer(tenantId: string, today: string): Promise<(inSubject: (subject: string | null) => boolean) => EnrolledTrend> {
  const [{ raw, en }, coverage] = await Promise.all([trendInputs(tenantId, today), loadRecordCoverage(tenantId, today).catch(warnCoverage)]);
  const trustFrom = coverage?.trustFrom ?? null;
  const months = monthlyPoints(today);
  const years = yearlyPoints(today, raw.fromYear);
  return (inSubject) => {
    const inRow = (e: { subject: string | null }) => inSubject(e.subject);
    return {
      ...clipTrend(
        subjectTrendOf(raw.students, en, raw.enrollments, months, inSubject, today),
        subjectTrendOf(raw.students, en, raw.enrollments, years, inSubject, today),
        trustFrom,
      ),
      recordsFrom: raw.recordsFrom,
      courses: clipCourses(
        courseTrendOf(raw.students, en, raw.enrollments, months, inRow, today),
        courseTrendOf(raw.students, en, raw.enrollments, years, inRow, today),
        trustFrom,
        breakdownFromOf(raw, today),
      ),
    };
  };
}

/**
 * 원생 통계 화면의 재원생 추이 — 월별 36개월 · 주별 26주 · 연도별(+ 고른 기간의 **일별** · 최대 두 달 — 원장 2026-10-21), 학원 전체 ·
 * 과목마다 · 수강 구성마다. `daily`는 일별 기간을 넘겼을 때만(날마다 그날 기준 — 오늘 뒤 날은 세지 않는다).
 */
export type TrendSeriesSet = { monthly: TrendPoint[]; weekly: TrendPoint[]; yearly: TrendPoint[]; daily?: TrendPoint[] };
export type EnrolledTrendDetail = {
  total: TrendSeriesSet;
  bySubject: ({ key: string } & TrendSeriesSet)[];
  byMix: ({ key: MixKey } & TrendSeriesSet)[];
  /** 재원생인데 그날 걸린 수강이 없는 학생 — 과목·구성으로 가를 수 없는 인원(화면이 신뢰 구간을 가른다). */
  unknown: TrendSeriesSet;
  /** 퇴원 기록이 시작된 달(YYYY-MM) — 그 전 기간은 재원생을 정확히 셀 수 없다. */
  recordsFrom: string | null;
  /**
   * 수강 종료가 처음 기록된 달(YYYY-MM) — 그 전에 끝난 수강은 남아 있지 않아(옛 퇴원생은 수강 행이 없다) 과목·구성을 가를 수 없다.
   * 실측 2026-10-20(침산): 가장 이른 수강 종료 2026-01-31 · 그 전 종료 0건 · 2025-02 재원생 348명 중 165명이 수강 기록 없음.
   * 끝난 수강이 하나도 없으면 null(새 지점 — 처음부터 다 기록돼 있다).
   */
  breakdownFrom: string | null;
};

export const DETAIL_MONTHS = 36;
export const DETAIL_WEEKS = 26;

/** 일별 점 — 날마다 그날 기준(`date = key`) · 라벨 `M.D` · 오늘 뒤 날은 뺀다(미래는 그리지 않는다 — `period.ts`와 같은 규칙). */
export function dailyPoints(days: readonly string[], today: string): { key: string; label: string; date: string }[] {
  return days.filter((d) => d <= today).map((d) => ({ key: d, label: `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`, date: d }));
}

/**
 * 원생 통계 화면(`/students/stats`) — 운영실 '재원생 추이'와 **같은 원본·같은 판정**(`trendOf`)을 더 긴 창으로, 과목별·수강 구성은
 * `breakdownTrendOf`(그날 걸린 수강으로만 가른다 — 수강 기록 없는 학생을 모든 과목에 넣지 않는다)로 그날로 되감아 센다.
 * 원본은 과목별 추이와 같은 5분 캐시를 나눠 쓴다(B6).
 * `subjects` = 학원설정 `operations.subjects`(레거시 라벨이 섞인 표를 넘기지 말 것 — programOf 규약).
 */
export async function loadEnrolledTrendDetail(
  tenantId: string,
  today: string,
  subjects: readonly ProgramSubject[],
  /**
   * 과목 관리자(원장 2026-10-20 *"자기 과목만"*) — 운영실 과목 관리자 화면과 같은 판정(`slicePredicate`). 주면 학원 전체 선 대신
   * **담당 과목 전체**(`subjectTrendOf` — 운영실 과목 관리자 '재원생 추이'와 같은 값) · 과목 선은 담당 과목만 · 수강 구성은 비운다.
   */
  scope?: (subject: string | null) => boolean,
  /** 일별로 볼 날들(`YYYY-MM-DD` · 최대 두 달 · 원장 2026-10-21) — 있으면 `daily`를 함께 센다. 오늘 뒤 날은 뺀다. */
  dailyDays?: readonly string[] | null,
): Promise<EnrolledTrendDetail> {
  const { raw, en } = await trendInputs(tenantId, today);
  const points = { monthly: monthlyPoints(today, DETAIL_MONTHS), weekly: weeklyPoints(today, DETAIL_WEEKS), yearly: yearlyPoints(today, raw.fromYear) };
  const daily = dailyDays ? dailyPoints(dailyDays, today) : null;
  const keys = subjects.map((s) => s.key);
  const groupOf = (subject: string | null) => subjectGroupOf(subject, subjects);
  const breakdown = (pts: readonly { key: string; label: string; date: string }[]) => breakdownTrendOf(raw.students, en, raw.enrollments, pts, keys, groupOf, today);
  const split = { monthly: breakdown(points.monthly), weekly: breakdown(points.weekly), yearly: breakdown(points.yearly), daily: daily ? breakdown(daily) : null };
  const totalOf = (pts: readonly { key: string; label: string; date: string }[]) =>
    scope ? subjectTrendOf(raw.students, en, raw.enrollments, pts, scope, today) : trendOf(raw.students, en, pts);
  const total: TrendSeriesSet = { monthly: totalOf(points.monthly), weekly: totalOf(points.weekly), yearly: totalOf(points.yearly), ...(daily ? { daily: totalOf(daily) } : {}) };
  const withDaily = <T,>(base: T, pick: (d: NonNullable<typeof split.daily>) => TrendPoint[]) => (split.daily ? { ...base, daily: pick(split.daily) } : base);
  return {
    total,
    bySubject: keys
      .filter((key) => !scope || scope(key))
      .map((key) => withDaily({ key, monthly: split.monthly.bySubject[key]!, weekly: split.weekly.bySubject[key]!, yearly: split.yearly.bySubject[key]! }, (d) => d.bySubject[key]!)),
    byMix: scope ? [] : MIX_KEYS.map((key) => withDaily({ key, monthly: split.monthly.mix[key], weekly: split.weekly.mix[key], yearly: split.yearly.mix[key] }, (d) => d.mix[key])),
    unknown: withDaily({ monthly: split.monthly.unknown, weekly: split.weekly.unknown, yearly: split.yearly.unknown }, (d) => d.unknown),
    recordsFrom: raw.recordsFrom,
    breakdownFrom: breakdownFromOf(raw, today),
  };
}
