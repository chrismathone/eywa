import "server-only";
import { kstToday, monthRange, shiftMonth } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { getTenantSettings } from "@/features/owner/server/queries";
import { loadBillingMonths } from "@/features/dashboard/overview/billing-months-server";
import type { SubjectBillingSummary } from "@/features/dashboard/overview/billing-subject";
import { subjectScopeOf, type StatsSubjectScope } from "@/features/students/stats/server/load";
import { hasBilling } from "./has-billing";
import { hasPeriodParams, monthKeysTo, paramsForMode, parsePeriodMode, parseStatsPeriod, type PeriodMode, type PeriodParams, type StatsPeriod } from "@/features/stats/period";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { DEFAULT_CURRENCY } from "@/features/billing/currencies";
import { expenseTrend, type ExpenseTrend } from "./expense-trend";

export const BILLING_STATS_PREFS_NS = "billingStats";

export type BillingStats = {
  today: string;
  months: string[];
  /** 과목 관리자면 그 보기(운영실과 같은 판정 · `?subject=` 전환), 아니면 null. */
  scope: StatsSubjectScope | null;
  scopeEmpty: boolean;
  /** 달마다 요약(오름차순 · 마지막 = 이번 달) — 실패는 null('못 불러옴'). */
  rows: SubjectBillingSummary[] | null;
  /**
   * 이미 발행된 **다음 달** 청구 — 청구서는 달이 오기 전에 나간다(실측 2026-10-20: 11월 청구 336건). 추이는 운영실 카드처럼 이번 달까지
   * 그리고, 다음 달은 한 줄로 따로 알린다(그 달 수납은 아직 시작 전이라 선에 넣으면 수납률이 꺾여 보인다). 청구서가 없으면 null.
   */
  next: SubjectBillingSummary | null;
  /** 지출 추이(학원 전체 — 운영실 지출 카드처럼 과목으로 가르지 않는다) · 실패는 null. */
  expenses: ExpenseTrend | null;
  expensePeriod: StatsPeriod;
};

/** 저장된 보기 방식(12·24개월) — 일별·구간은 이 화면에 없다(결제일이 대표 날짜 하나라 하루로 나누면 왜곡 — 코덱스 협의 2026-10-20). */
export function savedBillingMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[BILLING_STATS_PREFS_NS];
  const mode = parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).mode : undefined);
  return mode === "month" || mode === "month24" ? mode : null;
}

/** 저장된 지출 추이 보기 방식(12·24개월 · 일별 · 구간 — 지출일은 실제 날짜라 일별도 정직하다). */
function savedExpenseMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[BILLING_STATS_PREFS_NS];
  return parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).expenseMode : undefined);
}

/**
 * 지출 추이 재료 — 운영실 지출 카드(`getExpensesForMonth`)와 같은 줄(지출일 · 결재 상태 무관)을 기간으로. 필요한 네 칸만 받는다
 * (계좌번호 등 민감 칸은 싣지 않는다 · B2 `fetchAllPaged` · RLS가 지점을 가른다).
 */
async function loadExpenseTrend(period: StatsPeriod): Promise<ExpenseTrend> {
  const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
  // 월별은 이번 달 말일까지 — 운영실 카드(`getExpensesForMonth`)가 지출일이 오늘 뒤인 결의서도 이번 달에 세므로 같게(리뷰 2026-10-21).
  // 일별은 오늘까지(`period.ts` — 미래 날은 칸이 없다).
  const to = period.grain === "month" ? monthRange(period.months.at(-1)!).to : period.to;
  const db = await createClient();
  const rows = await fetchAllPaged<{ expense_date: string; amount: number | string; currency: string | null; category: string | null }>((a, b) =>
    db.from("expenses").select("expense_date, amount, currency, category").gte("expense_date", from).lte("expense_date", to).order("id").range(a, b),
  );
  return expenseTrend(
    rows.map((r) => ({ date: r.expense_date.slice(0, 10), amount: Number(r.amount) || 0, currency: r.currency || DEFAULT_CURRENCY, category: r.category?.trim() || "기타" })),
    period,
    DEFAULT_CURRENCY,
  );
}

/**
 * 수납 통계 원본(원장 2026-10-20 *"청구수납에 대해서도 상세 추이를 볼 수 있게"*) — 운영실 '6개월 청구 · 수납'과 **같은 함수**
 * (`loadBillingMonths`)를 더 긴 창으로 부른다 → 이번 달 값 = 카드 값. 과목 관리자는 운영실과 같은 판정(`subjectScopeOf` → 청구 항목별).
 * 호출부가 `requireAccess("billing")`를 먼저 지난다.
 */
export async function loadBillingStats(
  span: number | null,
  requestedSubject?: string,
  expenseParams: PeriodParams = {},
): Promise<BillingStats & { savedMode: PeriodMode | null }> {
  const today = kstToday();
  const [user, settings, prefs] = await Promise.all([getCurrentUser(), getTenantSettings(), readMyUiPrefs()]);
  if (!user) throw new Error("로그인이 필요합니다");
  const savedMode = savedBillingMode(prefs);
  const months = monthKeysTo(today, span ?? (savedMode === "month24" ? 24 : 12));
  const expenseMode = savedExpenseMode(prefs);
  const expensePeriod = parseStatsPeriod(hasPeriodParams(expenseParams) || !expenseMode ? expenseParams : paramsForMode(expenseMode, today), today);
  // 지출은 과목과 무관하다(운영실 지출 카드도 학원 전체) — 청구와 따로 함께 띄운다(B4).
  const expensesPromise = loadExpenseTrend(expensePeriod).catch((error: unknown) => {
    console.error("[billing/stats/expenses]", error);
    return null;
  });
  const base = { today, months, savedMode, scope: null, scopeEmpty: false, next: null, expensePeriod };
  const done = async <T extends object>(v: T) => ({ ...v, expenses: await expensesPromise });
  try {
    const scoped = await subjectScopeOf(user, settings, requestedSubject);
    if (scoped?.empty) return done({ ...base, scopeEmpty: true, rows: null });
    const pred = scoped && !scoped.empty ? scoped.pred : null;
    const [compute, nextCompute] = await Promise.all([
      loadBillingMonths(user.tenantId, months, !!pred),
      loadBillingMonths(user.tenantId, [shiftMonth(today.slice(0, 7), 1)], !!pred).catch(() => null),
    ]);
    const next = nextCompute?.(pred)[0] ?? null;
    return done({ ...base, scope: scoped && !scoped.empty ? scoped.scope : null, rows: compute(pred), next: next && hasBilling(next) ? next : null });
  } catch (error) {
    console.error("[billing/stats]", error);
    return done({ ...base, rows: null });
  }
}
