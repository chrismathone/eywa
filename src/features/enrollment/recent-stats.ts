/**
 * 운영실 '콜&상담 전환'의 **과목별 값**(원장 2026-10-14 2단계) — 지난달·이번 달 상담을 행으로 받아 DB 함수
 * `consultation_monthly_stats`(0178a)와 **같은 규칙**으로 센다. 순수 함수(Vitest).
 * 학원 전체 값은 종전대로 DB 함수가 센다 — 이 함수는 과목 관리자 값에만 쓴다(두 달치라 행이 수십 건).
 *
 * 규칙(0178a 그대로): 달 = 상담 시각(`consulted_at`)의 KST 달 · total = 전부 · enrolled/declined/no_show = 결과별 ·
 * open = 대기·예약·상담 완료·AI 완료 · paidSum = 등록분 결제 금액 합 · 전환율 = 등록 ÷ 전체(분모 0이면 null).
 */
import { kstDateOf, shiftMonth } from "@/lib/date-kst";
import type { EnrollmentStats, MonthStat } from "./server/stats-queries";

export type RecentConsultRow = { consultedAt: string; outcome: string; paymentAmount: number | null; subject: string | null };

const OPEN = new Set(["pending", "scheduled", "consulted", "ai_done"]);
const rateOf = (total: number, enrolled: number) => (total > 0 ? Math.round((enrolled / total) * 100) : null);

/** 지난달 · 이번 달(KST). */
export function recentConsultMonths(today: string): [string, string] {
  const current = today.slice(0, 7);
  return [shiftMonth(current, -1), current];
}

export function summarizeRecentEnrollment(rows: readonly RecentConsultRow[], today: string): EnrollmentStats {
  const months: MonthStat[] = recentConsultMonths(today).map((month) => {
    const mine = rows.filter((r) => kstDateOf(r.consultedAt)?.slice(0, 7) === month);
    const total = mine.length;
    const enrolled = mine.filter((r) => r.outcome === "enrolled").length;
    return {
      month,
      total,
      enrolled,
      declined: mine.filter((r) => r.outcome === "declined").length,
      noShow: mine.filter((r) => r.outcome === "no_show").length,
      open: mine.filter((r) => OPEN.has(r.outcome)).length,
      paidSum: mine.filter((r) => r.outcome === "enrolled").reduce((sum, r) => sum + (Number(r.paymentAmount) || 0), 0),
      rate: rateOf(total, enrolled),
    };
  });
  const total = months.reduce((sum, m) => sum + m.total, 0);
  const enrolled = months.reduce((sum, m) => sum + m.enrolled, 0);
  return { months, prevYearMonths: [], paths: [], total, enrolled, rate: rateOf(total, enrolled), paidSum: months.reduce((sum, m) => sum + m.paidSum, 0) };
}
