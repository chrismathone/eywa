import "server-only";
import { kstDateOf, kstToday, kstYear, shiftMonth, kstMonthStartIso as monthStartIso } from "@/lib/date-kst";
import { kstDayBounds } from "../kst-bounds";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { normalizeSchoolName } from "@/features/schools/school-name";
import { bucketizePathStats, type BucketStat, type PathStatRow } from "../path-bucket";
import { recentConsultMonths, type RecentConsultRow } from "../recent-stats";
import { buildManagementSheet, type ExitCohortRow, type ManagementSheet } from "../management-sheet";
import { intakeGroupMeta, intakeGroupsOf } from "../intake-groups";
import { getTenantSettings } from "@/features/owner/server/queries";
import { loadAttendingCounter } from "./management-attending";
import {
  buildSchoolBars,
  gradeLabel,
  sortGradeBars,
  type ConsultRow,
  type DistBar,
  type SchoolBar,
} from "../consultation-dist";

/**
 * 통계뷰 데이터. **행을 가져오지 않는다** — 0178a의 group-by RPC가 집계만 돌려준다(B2).
 * 그래서 칸반·목록의 "최대 1년" 상한이 여기엔 없다(원장 목적 = 올해 vs 작년 비교).
 */

export type MonthStat = {
  month: string; // "YYYY-MM"
  total: number;
  enrolled: number;
  declined: number;
  noShow: number;
  open: number;
  paidSum: number;
  /** 등록 전환율(%). 분모 0이면 null — 0%로 그리면 "다 놓쳤다"로 읽힌다. */
  rate: number | null;
};

export type EnrollmentStats = {
  /** 요청 구간의 월별(빈 달도 0으로 채워 선이 끊기지 않게). */
  months: MonthStat[];
  /** 같은 길이의 **직전 해** 같은 달들 — 전년 동월 비교용. 데이터가 없으면 빈 배열. */
  prevYearMonths: MonthStat[];
  /**
   * 올해를 볼 때 **작년 같은 기간**(1월 1일 ~ 작년 오늘) 합계 — 헤드라인 증감의 비교 대상. 올해는 오늘까지만 있는데
   * 작년 1~12월 전체와 견주면 "상담 −45%"처럼 거짓 감소가 선다(검수 2026-10-22). 지난해를 볼 땐 null(1~12월끼리 견준다).
   */
  prevSamePeriod?: { total: number; enrolled: number; to: string } | null;
  paths: BucketStat[];
  /** 구간 합계. months에서 도출하지 않고 같은 원천으로 계산(둘이 갈리면 헤더와 차트가 다른 말을 한다). */
  total: number;
  enrolled: number;
  rate: number | null;
  paidSum: number;
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** KST 기준 그 달 1일 00:00의 UTC 시각. RPC가 KST로 버킷을 자르므로 경계도 KST로 준다. */
function kstMonthStartIso(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1, -9, 0, 0)).toISOString();
}

function toMonthStat(r: {
  month: string;
  total: number | string;
  enrolled: number | string;
  declined: number | string;
  no_show: number | string;
  open_cnt: number | string;
  paid_sum: number | string;
}): MonthStat {
  const total = Number(r.total);
  const enrolled = Number(r.enrolled);
  return {
    month: r.month,
    total,
    enrolled,
    declined: Number(r.declined),
    noShow: Number(r.no_show),
    open: Number(r.open_cnt),
    paidSum: Number(r.paid_sum),
    rate: total > 0 ? Math.round((enrolled / total) * 100) : null,
  };
}

/** 빈 달을 0으로 채운다 — 안 채우면 상담이 없던 달에서 선이 이어져 "그 달에도 있었다"로 보인다. */
function fillMonths(rows: MonthStat[], startY: number, startM0: number, count: number): MonthStat[] {
  const byKey = new Map(rows.map((r) => [r.month, r]));
  const out: MonthStat[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startY, startM0 + i, 1);
    const key = monthKey(d);
    out.push(
      byKey.get(key) ?? {
        month: key,
        total: 0,
        enrolled: 0,
        declined: 0,
        noShow: 0,
        open: 0,
        paidSum: 0,
        rate: null,
      },
    );
  }
  return out;
}

/**
 * @param year 보려는 연도. `null` = **전체 기간**(원장 2026-08-05). 통계는 집계라 행을 안 가져와
 *   기간 상한이 없다 — 칸반·목록의 "최대 1년"은 행 로딩 때문이지 여기와 무관하다.
 * @param span 전체일 때 훑을 범위(가장 이른 해 ~ 올해). 연도별일 땐 무시.
 */
export async function getEnrollmentStats(
  year: number | null,
  span?: { from: number; to: number },
): Promise<EnrollmentStats> {
  const supabase = await createClient();
  const startM0 = 0;
  const isAll = year === null;
  const fromY = isAll ? (span?.from ?? kstYear()) : year;
  const months = isAll ? ((span?.to ?? fromY) - fromY + 1) * 12 : 12;
  const start = kstMonthStartIso(fromY, startM0);
  const end = kstMonthStartIso(fromY, startM0 + months);
  // 전체 기간엔 '전년 동월' 비교가 성립하지 않는다(비교 대상이 구간 안에 들어 있다) → 빈 배열로 둔다.
  const prevStart = kstMonthStartIso(fromY - 1, startM0);
  const prevEnd = kstMonthStartIso(fromY - 1, startM0 + months);
  // 올해면 작년 같은 날까지만 따로 센다(2월 29일은 작년 2월 28일까지).
  const today = kstToday();
  const thisMonth = today.slice(0, 7);
  const sameDayLastYear = (() => {
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  })();
  const ytd = !isAll && year === Number(today.slice(0, 4));

  // 독립 조회 = 병렬(B4). 전년치는 비교용이라 없으면 빈 배열로 떨어져도 화면이 산다.
  const [cur, prev, paths, prevYtd] = await Promise.all([
    supabase.rpc("consultation_monthly_stats", { p_start: start, p_end: end }),
    isAll
      ? Promise.resolve({ data: [], error: null })
      : supabase.rpc("consultation_monthly_stats", { p_start: prevStart, p_end: prevEnd }),
    supabase.rpc("consultation_path_stats", { p_start: start, p_end: end }),
    ytd
      ? supabase.rpc("consultation_monthly_stats", { p_start: prevStart, p_end: kstDayBounds(sameDayLastYear).endIso })
      : Promise.resolve({ data: null, error: null }),
  ]);
  // 조회 실패를 '0건'으로 위장하지 않는다 — 빈 통계와 장애는 화면에서 구분돼야 한다.
  if (cur.error) throw cur.error;
  if (paths.error) throw paths.error;

  // 아직 오지 않은 **빈** 달은 빼 둔다 — 0으로 채워 넘기면 차트 툴팁이 '11월 상담 0건'이라 말한다(trend-series는 빈 달을 비워 두게 돼 있다).
  // 미래 날짜로 넣은 상담이 있는 달은 남긴다(빼면 헤드라인 합계가 같은 기간을 세는 유입경로·분포와 갈린다).
  const curMonths = fillMonths((cur.data ?? []).map(toMonthStat), fromY, startM0, months).filter((m) => m.month <= thisMonth || m.total > 0);
  const prevYearMonths =
    isAll || prev.error ? [] : fillMonths((prev.data ?? []).map(toMonthStat), fromY - 1, startM0, months);
  const prevYtdRows = !ytd || prevYtd.error || !prevYtd.data ? null : (prevYtd.data as Parameters<typeof toMonthStat>[0][]).map(toMonthStat);
  const prevSamePeriod = prevYtdRows
    ? { total: prevYtdRows.reduce((a, m) => a + m.total, 0), enrolled: prevYtdRows.reduce((a, m) => a + m.enrolled, 0), to: sameDayLastYear }
    : null;

  const total = curMonths.reduce((a, m) => a + m.total, 0);
  const enrolled = curMonths.reduce((a, m) => a + m.enrolled, 0);

  return {
    months: curMonths,
    prevYearMonths,
    prevSamePeriod,
    paths: bucketizePathStats(
      (paths.data ?? []).map(
        (r: {
          path: string | null;
          total: number | string;
          enrolled: number | string;
          paid_sum: number | string;
          paid_cnt?: number | string | null;
        }): PathStatRow => ({
          path: r.path,
          total: Number(r.total),
          enrolled: Number(r.enrolled),
          paidSum: Number(r.paid_sum),
          // 0179a 적용 전엔 이 컬럼이 없다 → null로 두면 화면이 건당 평균을 안 그린다(옛/새 스키마 둘 다 동작).
          paidCount: r.paid_cnt === undefined || r.paid_cnt === null ? null : Number(r.paid_cnt),
        }),
      ),
    ),
    total,
    enrolled,
    rate: total > 0 ? Math.round((enrolled / total) * 100) : null,
    paidSum: curMonths.reduce((a, m) => a + m.paidSum, 0),
  };
}

/** Dashboard: previous and current month by default, including December across a year boundary. `count` = 이번 달까지 몇 달. */
export async function getRecentEnrollmentStats(today: string, count = 2): Promise<EnrollmentStats> {
  const current = today.slice(0, 7);
  const first = shiftMonth(current, -(count - 1));
  const db = await createClient();
  const { data, error } = await db.rpc("consultation_monthly_stats", {
    p_start: monthStartIso(first),
    p_end: monthStartIso(shiftMonth(current, 1)),
  });
  if (error) throw error;
  const months = fillMonths((data ?? []).map(toMonthStat), Number(first.slice(0, 4)), Number(first.slice(5)) - 1, count);
  const total = months.reduce((sum, row) => sum + row.total, 0);
  const enrolled = months.reduce((sum, row) => sum + row.enrolled, 0);
  return {
    months, prevYearMonths: [], prevSamePeriod: null, paths: [], total, enrolled,
    rate: total > 0 ? Math.round(enrolled / total * 100) : null,
    paidSum: months.reduce((sum, row) => sum + row.paidSum, 0),
  };
}

/**
 * 운영실 '콜&상담 전환'의 과목별 값 재료 — 지난달 1일 ~ 다음 달 1일(KST) 상담 행(두 달치, 수십 건 · `recent-stats.ts`가 센다).
 * 학원 전체 값은 위 DB 함수가 세고, 이 행은 과목 관리자 화면에서만 쓴다.
 */
export async function getRecentConsultationRows(today: string): Promise<RecentConsultRow[]> {
  const [previous, current] = recentConsultMonths(today);
  const db = await createClient();
  const rows = await fetchAllPaged<{ consulted_at: string; outcome: string; payment_amount: number | string | null; subject: string | null }>((from, to) =>
    db
      .from("enrollment_consultations")
      .select("consulted_at, outcome, payment_amount, subject")
      .gte("consulted_at", monthStartIso(previous))
      .lt("consulted_at", monthStartIso(shiftMonth(current, 1)))
      .order("id")
      .range(from, to),
  );
  return rows.map((r) => ({ consultedAt: r.consulted_at, outcome: r.outcome, paymentAmount: r.payment_amount === null ? null : Number(r.payment_amount), subject: r.subject || null }));
}

export type { DistBar, SchoolBar } from "../consultation-dist";

export type ConsultationDistribution = {
  /** 학년별 상담 — 급이 붙은 라벨(초4·중2). 급을 모르면 뒤로 밀린다. */
  grades: DistBar[];
  /** 학교 소재 구별. 상담에 주소가 없어도 **학교로** 지역을 안다. */
  regions: DistBar[];
  schools: SchoolBar[];
  total: number;
  /** 전교생 대비 비율을 낼 수 있는 해인지 — 공시가 이 해 것일 때만 true. */
  hasTotals: boolean;
  /** 우리가 가진 공시 연도(예 2026). 화면이 "왜 비율이 없는지" 설명할 때 쓴다. */
  totalsYear: number | null;
  /** 관리현황(달마다 상담·등록·완료율 · 과목 묶음마다) — 같은 상담 행으로 센다(management-sheet.ts). */
  sheet: ManagementSheet;
  /** 과목 묶음 → 이름·색(학원 설정 — 화면에 키를 내보내지 않는다). */
  sheetGroups: Record<string, { label: string; color: string }>;
  /** 등록한 상담에 이어진 원생(달 · 학생 · 상담일) — 관리현황 '등록 후 퇴원'의 재료(퇴원 목록과 맞춰 보는 것은 화면 쪽 — 권한이 있을 때만). */
  cohorts: ExitCohortRow[];
};

/**
 * 그 해 **등록상담**을 학년·지역·학교로 나눈다.
 *
 * 🔴 재원생/퇴원생이 아니라 **상담**이다(원장 2026-08-05). 여기는 등록상담 화면이고, 재원생 축은
 * 연도 선택과 무관해 화면이 거짓말을 했다. 재원생·퇴원생 분포는 학생목록에서 다룰 것.
 *
 * ⚠️ 전교생 대비 비율은 **공시 연도와 보는 연도가 같을 때만** 낸다. 우리가 가진 학교알리미 공시는
 * 한 해치뿐이라, 2023년 상담을 2026년 전교생으로 나누면 그럴듯하지만 틀린 숫자가 된다.
 */
export async function getConsultationDistribution(
  year: number | null,
  span?: { from: number; to: number },
): Promise<ConsultationDistribution> {
  const supabase = await createClient();
  const isAll = year === null;
  const fromY = isAll ? (span?.from ?? kstYear()) : year;
  const toY = isAll ? (span?.to ?? fromY) : year;
  const start = kstMonthStartIso(fromY, 0);
  const end = kstMonthStartIso(toY + 1, 0);

  const today = kstToday();
  const settingsPromise = getTenantSettings();
  const [rows, schoolStats, settings, attending] = await Promise.all([
    fetchAllPaged<{
      prospect_school: string | null;
      prospect_grade: string | null;
      outcome: string;
      consulted_at: string;
      subject: string | null;
      student_id: string | null;
      follow_up_date: string | null;
    }>(
      (from, to) =>
        supabase
          .from("enrollment_consultations")
          // follow_up_date — 관리현황 '장기 미결'(오늘 이후 다음 상담일이 잡히면 진행 중)의 재료.
          .select("prospect_school, prospect_grade, outcome, consulted_at, subject, student_id, follow_up_date")
          .gte("consulted_at", start)
          .lt("consulted_at", end)
          // 🔴 페이지로 나눠 받으면 정렬이 있어야 한다 — 없으면 3개년(1,500건+)에서 페이지 경계의 행이 겹치거나 빠진다(검수 2026-10-22).
          .order("id")
          .range(from, to),
    ),
    fetchAllPaged<{ name: string; name_key: string; kind: string; total_students: number; region: string | null; year: number }>(
      (from, to) =>
        supabase
          .from("school_enrollment_stats")
          // 🔴 **보는 해의 공시만** 받는다. 4개 연도(2023~2026)가 적재돼 있어 전부 받으면 같은 학교가
          // 해마다 한 번씩 들어와 마지막 것이 이겨 버린다 — 2023년 상담을 2026년 전교생으로 나누는
          // 바로 그 오류다. (`.eq`는 `.select` 뒤에만 온다 — 빌더 순서.)
          .select("name, name_key, kind, total_students, region, year")
          // 🔴 전체 기간이면 **어느 해 전교생으로 나눠야 할지 정할 수 없다** → 아예 안 받는다.
          //    한 해를 골라 나누면 그럴듯하지만 틀린 비율이 된다(연도별로 전교생이 매년 준다:
          //    대구칠성초 2023년 1,396명 → 2026년 1,207명).
          .eq("year", isAll ? -1 : year)
          .order("name_key", { ascending: true })
          .range(from, to),
    ),
    settingsPromise,
    // 관리현황 '지금 재원' — 원생목록과 같은 재원 판정(조회는 상담 행과 독립이라 함께 — B4 · 실패하면 null).
    settingsPromise.then((s) => loadAttendingCounter(s.operations.subjects, today)),
  ]);

  // 그 해 공시가 있으면 비율을 낸다. 없으면(예: 아직 안 받은 연도) 건수·전환율만 보여준다.
  const hasTotals = schoolStats.length > 0;
  const totalsYear = hasTotals ? year : null;
  const byKey = new Map(schoolStats.map((s) => [s.name_key, s]));

  const consults: ConsultRow[] = rows.map((r) => ({
    school: r.prospect_school,
    grade: r.prospect_grade,
    enrolled: r.outcome === "enrolled",
  }));

  const gradeAcc = new Map<string, { n: number; e: number }>();
  const regionAcc = new Map<string, { n: number; e: number }>();
  for (const c of consults) {
    const g = gradeLabel(c.grade, c.school);
    const gv = gradeAcc.get(g) ?? { n: 0, e: 0 };
    gv.n += 1;
    if (c.enrolled) gv.e += 1;
    gradeAcc.set(g, gv);

    // 지역은 학교 소재지로 — 상담에 주소가 거의 없고, 학교는 99% 채워져 있다.
    const region =
      byKey.get(normalizeSchoolName(c.school))?.region?.replace(/^대구광역시\s*/, "").trim() || "미상";
    const rv = regionAcc.get(region) ?? { n: 0, e: 0 };
    rv.n += 1;
    if (c.enrolled) rv.e += 1;
    regionAcc.set(region, rv);
  }

  const toBars = (m: Map<string, { n: number; e: number }>): DistBar[] =>
    [...m].map(([label, v]) => ({ label, n: v.n, enrolled: v.e }));

  return {
    grades: sortGradeBars(toBars(gradeAcc)),
    // 많은 순, '미상'은 항상 끝(지표가 아니라 데이터 품질 표시).
    regions: toBars(regionAcc).sort((a, b) =>
      a.label === "미상" ? 1 : b.label === "미상" ? -1 : b.n - a.n,
    ),
    schools: buildSchoolBars(
      consults,
      hasTotals
        ? new Map([...byKey].map(([k, v]) => [k, { name: v.name, kind: v.kind, total: v.total_students }]))
        : null,
    ),
    total: consults.length,
    hasTotals,
    totalsYear,
    sheet: buildManagementSheet(
      rows.map((r) => ({
        month: kstMonthOf(r.consulted_at),
        subject: r.subject,
        outcome: r.outcome,
        consultedOn: kstDateOf(r.consulted_at) ?? `${kstMonthOf(r.consulted_at)}-01`,
        followUpDate: r.follow_up_date,
        studentId: r.student_id,
      })),
      intakeGroupsOf(settings.operations.subjects),
      { today, attending },
    ),
    sheetGroups: intakeGroupMeta(settings.operations.subjects),
    cohorts: rows.flatMap((r) => {
      const consultedOn = kstDateOf(r.consulted_at);
      return r.outcome === "enrolled" && r.student_id && consultedOn
        ? [{ month: kstMonthOf(r.consulted_at), studentId: r.student_id, consultedOn }]
        : [];
    }),
  };
}

/** 상담일(timestamptz) → KST 달 `YYYY-MM` — DB 함수가 달을 자르는 것과 같은 경계(`at time zone 'Asia/Seoul'`). */
function kstMonthOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
}

/** 통계 연도 선택지 — 데이터가 있는 연도만(없는 해를 고르면 빈 화면으로 걸어 들어간다). */
export async function getStatsYears(): Promise<number[]> {
  const supabase = await createClient();
  const [{ data: first }, { data: last }] = await Promise.all([
    supabase
      .from("enrollment_consultations")
      .select("consulted_at")
      .order("consulted_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("enrollment_consultations")
      .select("consulted_at")
      .order("consulted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const yearOf = (iso: string | null | undefined) =>
    iso
      ? Number(
          new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(
            new Date(iso),
          ),
        )
      : kstYear();
  const from = yearOf(first?.consulted_at);
  const to = yearOf(last?.consulted_at);
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}
