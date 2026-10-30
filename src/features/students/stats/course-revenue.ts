import type { HistoryMonth } from "./history";
import { historyGroupCount } from "./joined";
import type { TuitionMonth } from "@/features/billing/stats/tuition-history";

/**
 * **과목 수와 매출**(원장 2026-10-30 *"과목이 늘어나면 매출이 느는지 상관관계를 알아볼 필요있음"*) — 지난 기록 월별 집계로 달마다
 * 학생당 강좌 수와 학생당 수업료를 견준다. 순수 함수(Vitest).
 *   학생 = 그달 수업료가 청구된 학생(`payingTotal`) · 강좌 = 과목마다 청구된 학생 수의 합(`historyGroupCount` — 강좌수 추이와 같은 판정)
 *   수업료 = 그달 수업료 수납(EiE 외 + EiE · `tuition-history.ts`)
 * 🔑 총량끼리(강좌 수 ↔ 매출) 견주면 학생 수가 늘어난 효과가 그대로 섞여 늘 높게 나온다 — 그래서 **학생당**으로 나눠 견준다(같이 보여 준다).
 * 🔑 청구 방식이 바뀐 달(앞뒤로 이은 달 · 건너뛴 달)과, 학생당 수업료가 앞뒤 석 달 가운데값에서 40% 넘게 벗어난 달(2025-03·04처럼 다음 달
 *    수업료를 미리 청구한 달)은 뺀다 — 몇 달이 상관을 흔들지 않게. 뺀 달은 화면이 밝힌다.
 */
export type CourseRevenueMonth = {
  month: string;
  students: number;
  courses: number;
  revenue: number;
  coursesPerStudent: number;
  revenuePerStudent: number;
  /** 뺀 까닭 — 없으면 분석에 든다. */
  excluded?: "billing-change" | "outlier";
};

/** `before`(YYYY-MM) = 이 달부터는 뺀다 — 진행 중인 달은 청구(학생)와 수납(매출)이 아직 맞지 않는다(리뷰 2026-10-30). */
export function courseRevenueMonths(
  months: readonly HistoryMonth[],
  tuition: readonly TuitionMonth[],
  groups: readonly string[],
  before?: string,
): CourseRevenueMonth[] {
  if (!groups.length) return [];
  const money = new Map(tuition.map((t) => [t.month, (t.general ?? 0) + (t.eie ?? 0)]));
  const rows: CourseRevenueMonth[] = [];
  for (const m of months) {
    if (before && m.month >= before) continue;
    const students = m.payingTotal ?? 0;
    const revenue = money.get(m.month) ?? 0;
    if (students <= 0 || revenue <= 0) continue;
    let courses = 0;
    let known = true;
    for (const g of groups) {
      const n = historyGroupCount(m, g);
      if (n === null) known = false;
      else courses += n;
    }
    if (!known || courses <= 0) continue;
    rows.push({
      month: m.month, students, courses, revenue,
      coursesPerStudent: courses / students,
      revenuePerStudent: revenue / students,
      ...(m.bridged ? { excluded: "billing-change" as const } : {}),
    });
  }
  // 앞뒤 석 달 가운데값에서 40% 넘게 벗어난 달 — 청구 방식이 바뀐 달의 몰림·빠짐.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.excluded) continue;
    const near = rows.slice(Math.max(0, i - 3), i + 4).filter((r, j) => j !== Math.min(i, 3) && !r.excluded).map((r) => r.revenuePerStudent).sort((a, b) => a - b);
    if (near.length < 2) continue;
    const median = near[Math.floor(near.length / 2)]!;
    if (Math.abs(rows[i]!.revenuePerStudent - median) / median > 0.4) rows[i] = { ...rows[i]!, excluded: "outlier" };
  }
  return rows;
}

/** 피어슨 상관계수 — 점이 3개 미만이거나 한쪽이 변하지 않으면 null. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** 최소제곱 기울기(y가 x 1 늘 때 늘어나는 양) — 점 2개 미만 · x가 안 변하면 null. */
export function slope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  return sxx === 0 ? null : sxy / sxx;
}

export type CourseRevenueSummary = {
  months: number;
  from: string | null;
  to: string | null;
  excluded: string[];
  /** 학생당 강좌 수 ↔ 학생당 수업료 상관 · 강좌 0.1개당 학생당 수업료 변화(원). */
  perStudent: { r: number | null; per01: number | null };
  /** 총량 — 강좌 수 ↔ 수업료(학생 수 효과가 섞인 값 · 참고용). */
  total: { r: number | null };
  yearly: { year: string; months: number; coursesPerStudent: number; revenuePerStudent: number; revenuePerCourse: number }[];
};

export function courseRevenueSummary(rows: readonly CourseRevenueMonth[]): CourseRevenueSummary {
  const used = rows.filter((r) => !r.excluded);
  const cps = used.map((r) => r.coursesPerStudent);
  const rps = used.map((r) => r.revenuePerStudent);
  const k = slope(cps, rps);
  const byYear = new Map<string, CourseRevenueMonth[]>();
  for (const r of used) byYear.set(r.month.slice(0, 4), [...(byYear.get(r.month.slice(0, 4)) ?? []), r]);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    months: used.length,
    from: used[0]?.month ?? null,
    to: used.at(-1)?.month ?? null,
    excluded: rows.filter((r) => r.excluded).map((r) => r.month),
    perStudent: { r: pearson(cps, rps), per01: k === null ? null : k / 10 },
    total: { r: pearson(used.map((r) => r.courses), used.map((r) => r.revenue)) },
    yearly: [...byYear].map(([year, list]) => ({
      year,
      months: list.length,
      coursesPerStudent: avg(list.map((r) => r.coursesPerStudent)),
      revenuePerStudent: avg(list.map((r) => r.revenuePerStudent)),
      revenuePerCourse: avg(list.map((r) => r.revenue / r.courses)),
    })),
  };
}

/** 상관의 세기 말 — |r| 기준(흔한 구분). */
export function correlationWord(r: number | null): string {
  if (r === null) return "판단할 수 없음";
  const a = Math.abs(r);
  const dir = r >= 0 ? "양의" : "음의";
  return a >= 0.7 ? `강한 ${dir} 상관` : a >= 0.4 ? `뚜렷한 ${dir} 상관` : a >= 0.2 ? `약한 ${dir} 상관` : "상관 거의 없음";
}
