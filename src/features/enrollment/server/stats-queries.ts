import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bucketizePathStats, type BucketStat, type PathStatRow } from "../path-bucket";

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
 * @param year 보려는 연도
 * @param months 그 연도에서 볼 개월 수(12=한 해 전체). 화면 상단 토글이 준다.
 */
export async function getEnrollmentStats(year: number, months = 12): Promise<EnrollmentStats> {
  const supabase = await createClient();
  const startM0 = 0;
  const start = kstMonthStartIso(year, startM0);
  const end = kstMonthStartIso(year, startM0 + months);
  const prevStart = kstMonthStartIso(year - 1, startM0);
  const prevEnd = kstMonthStartIso(year - 1, startM0 + months);

  // 독립 조회 3개 = 병렬(B4). 전년치는 비교용이라 없으면 빈 배열로 떨어져도 화면이 산다.
  const [cur, prev, paths] = await Promise.all([
    supabase.rpc("consultation_monthly_stats", { p_start: start, p_end: end }),
    supabase.rpc("consultation_monthly_stats", { p_start: prevStart, p_end: prevEnd }),
    supabase.rpc("consultation_path_stats", { p_start: start, p_end: end }),
  ]);
  // 조회 실패를 '0건'으로 위장하지 않는다 — 빈 통계와 장애는 화면에서 구분돼야 한다.
  if (cur.error) throw cur.error;
  if (paths.error) throw paths.error;

  const curMonths = fillMonths((cur.data ?? []).map(toMonthStat), year, startM0, months);
  const prevYearMonths = prev.error
    ? []
    : fillMonths((prev.data ?? []).map(toMonthStat), year - 1, startM0, months);

  const total = curMonths.reduce((a, m) => a + m.total, 0);
  const enrolled = curMonths.reduce((a, m) => a + m.enrolled, 0);

  return {
    months: curMonths,
    prevYearMonths,
    paths: bucketizePathStats(
      (paths.data ?? []).map(
        (r: { path: string | null; total: number | string; enrolled: number | string; paid_sum: number | string }): PathStatRow => ({
          path: r.path,
          total: Number(r.total),
          enrolled: Number(r.enrolled),
          paidSum: Number(r.paid_sum),
        }),
      ),
    ),
    total,
    enrolled,
    rate: total > 0 ? Math.round((enrolled / total) * 100) : null,
    paidSum: curMonths.reduce((a, m) => a + m.paidSum, 0),
  };
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
      : new Date().getFullYear();
  const from = yearOf(first?.consulted_at);
  const to = yearOf(last?.consulted_at);
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}
