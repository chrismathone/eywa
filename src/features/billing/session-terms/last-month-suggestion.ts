import { validSessionQuantity, type SessionPricingMode, type SessionQuantityBasis } from "@/features/billing/session-pricing";

/** 지난 달 같은 학생·같은 반의 확정 행(필요한 칸만). */
export type LastMonthTerm = {
  confirmedSessions: number;
  unitPrice: number | null;
  pricingMode: SessionPricingMode;
  quantityBasis: SessionQuantityBasis;
};

/** 미확정 행의 입력칸에 미리 채울 값 + 근거(화면 카드). */
export type TermSuggestion = {
  price: number;
  /** null이면 시수는 이번 달 예정 그대로(지난 달도 예정대로 확정했거나, 비율을 믿을 근거가 없다). */
  sessions: number | null;
  last: { sessions: number; price: number; planned: number | null };
};

/** "YYYY-MM" 한 달 전. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 지난 달 확정값으로 이번 달 입력칸을 미리 채운다 — 원장 2026-09-17 *"이 확정된 단가 및 시수들을 참고해서 다음달도 대부분 스마트하게
 * 확정처리하면 좋겠네. (일부 3시간 수업을 2시간만 듣는다는 등의 학생들)"* → 고른 방식 *"입력칸만 미리 채움"*.
 * 🔴 **채우기만 한다** — 확정(저장)은 사람이 확인 후 개별·선택 일괄 확정으로. 확정한 값만 청구값이다(N1).
 * - 단가 = 지난 달 확정 단가.
 * - 시수 = 이번 달 예정 × (지난 달 확정 ÷ 지난 달 예정), 0.5 단위(가운데 값은 **아래로** — 학부모에게 더 받지 않는다).
 *   3시간 반을 2시간만 듣는 학생은 지난 달 비율(2/3)이 따라온다.
 * 🔴 **줄어든 비율만 따른다** — 지난 달 예정은 *지금의* 수강·등원 요일로 다시 센 값이라, 그 사이 요일을 줄인 학생은 비율이 1을 넘어
 *    더 청구하는 쪽으로 채워진다(적대적 리뷰 2026-09-17). 비율이 1 이상이면 시수는 이번 달 예정 그대로.
 *    ⚠️ 줄어든 쪽도 한 달만 휴원·결석으로 깎았던 학생과 구분이 안 된다 — 그래서 화면은 비율 칸을 주황으로 칠하고 일괄 확정 전에 묻는다.
 * 🔴 **이번 달 예정이 0이면 아무것도 채우지 않는다** — 단가만 채우면 `0시수 × 단가 = 0원`이 선택 일괄 확정을 그대로 통과한다
 *    (종전엔 빈 단가가 막았다).
 * - 월 정액(EiE)·단가 없음·일수 기준 옛 확정(재확정 대상 — 그 단가가 하루 단가일 수 있다)은 제안하지 않는다.
 */
export function suggestFromLastMonth(currentPlan: number | null, last: LastMonthTerm | null, lastPlan: number | null): TermSuggestion | null {
  if (!last || last.pricingMode === "monthly" || last.quantityBasis !== "attendance_units") return null;
  if (last.unitPrice === null || !Number.isFinite(last.unitPrice) || last.unitPrice <= 0) return null;
  if (currentPlan === null || !(currentPlan > 0)) return null;
  const base = { price: last.unitPrice, last: { sessions: last.confirmedSessions, price: last.unitPrice, planned: lastPlan } };
  if (lastPlan === null || !(lastPlan > 0)) return { ...base, sessions: null };
  const ratio = last.confirmedSessions / lastPlan;
  if (!(ratio < 1 - 1e-9)) return { ...base, sessions: null };
  const scaled = Math.ceil(currentPlan * ratio * 2 - 0.5 - 1e-9) / 2;
  return { ...base, sessions: scaled > 0 && scaled !== currentPlan && validSessionQuantity(scaled) ? scaled : null };
}

/** 시수 칸이 아직 '지난 달 비율로 줄인' 제안 그대로인가 — 사람이 안 고쳤다(주황 칸 · 일괄 확정 전 확인). */
export function isUntouchedScaledSessions(row: { confirmedSessions: number | null; lastMonth?: TermSuggestion | null }, sessionsDraft: string): boolean {
  return row.confirmedSessions === null && row.lastMonth?.sessions != null && sessionsDraft === String(row.lastMonth.sessions);
}
