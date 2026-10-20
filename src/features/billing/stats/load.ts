import "server-only";
import { kstToday, shiftMonth } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { getTenantSettings } from "@/features/owner/server/queries";
import { loadBillingMonths } from "@/features/dashboard/overview/billing-months-server";
import type { SubjectBillingSummary } from "@/features/dashboard/overview/billing-subject";
import { subjectScopeOf, type StatsSubjectScope } from "@/features/students/stats/server/load";
import { hasBilling } from "./has-billing";
import { monthKeysTo, parsePeriodMode, type PeriodMode } from "@/features/stats/period";

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
};

/** 저장된 보기 방식(12·24개월) — 일별·구간은 이 화면에 없다(결제일이 대표 날짜 하나라 하루로 나누면 왜곡 — 코덱스 협의 2026-10-20). */
export function savedBillingMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[BILLING_STATS_PREFS_NS];
  const mode = parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).mode : undefined);
  return mode === "month" || mode === "month24" ? mode : null;
}

/**
 * 수납 통계 원본(원장 2026-10-20 *"청구수납에 대해서도 상세 추이를 볼 수 있게"*) — 운영실 '6개월 청구 · 수납'과 **같은 함수**
 * (`loadBillingMonths`)를 더 긴 창으로 부른다 → 이번 달 값 = 카드 값. 과목 관리자는 운영실과 같은 판정(`subjectScopeOf` → 청구 항목별).
 * 호출부가 `requireAccess("billing")`를 먼저 지난다.
 */
export async function loadBillingStats(span: number | null, requestedSubject?: string): Promise<BillingStats & { savedMode: PeriodMode | null }> {
  const today = kstToday();
  const [user, settings, prefs] = await Promise.all([getCurrentUser(), getTenantSettings(), readMyUiPrefs()]);
  if (!user) throw new Error("로그인이 필요합니다");
  const savedMode = savedBillingMode(prefs);
  const months = monthKeysTo(today, span ?? (savedMode === "month24" ? 24 : 12));
  const base = { today, months, savedMode, scope: null, scopeEmpty: false, next: null };
  try {
    const scoped = await subjectScopeOf(user, settings, requestedSubject);
    if (scoped?.empty) return { ...base, scopeEmpty: true, rows: null };
    const pred = scoped && !scoped.empty ? scoped.pred : null;
    const [compute, nextCompute] = await Promise.all([
      loadBillingMonths(user.tenantId, months, !!pred),
      loadBillingMonths(user.tenantId, [shiftMonth(today.slice(0, 7), 1)], !!pred).catch(() => null),
    ]);
    const next = nextCompute?.(pred)[0] ?? null;
    return { ...base, scope: scoped && !scoped.empty ? scoped.scope : null, rows: compute(pred), next: next && hasBilling(next) ? next : null };
  } catch (error) {
    console.error("[billing/stats]", error);
    return { ...base, rows: null };
  }
}
