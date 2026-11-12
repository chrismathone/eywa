/**
 * 퇴원관리 '월별 추이' 보기 — `학원 전체` 막대 켜기/끄기 · 막대/꺾은선(원장 2026-09-29 *"전체 on/off 토글만들고, 대시보드처럼
 * 막대/꺾은선 전환 토글 추가"*). 계정 귀속(`users.ui_prefs.withdrawals`) · 기본값(켜짐·막대)은 저장하지 않는다.
 * 분석 카드의 축(과목·강사·학년·학교 — 원장 2026-10-15)도 같은 자리(`breakdown_axis`)에 둔다 · 기본(과목)은 저장하지 않는다.
 * '강사별 퇴원율 추이' 표의 정렬(원장 2026-11-11)도 같은 자리(`churn_sort`) · 기본(최근 마감 달 높은 순)은 저장하지 않는다.
 * 같은 카드의 표 | 차트 보기(원장 2026-11-11 *"차트로 전환도 가능하게 표/차트"*)도 같은 자리(`churn_view`) · 기본(표)은 저장하지 않는다.
 * ⚠️ 일반 모듈 — 서버(초기값)와 클라(토글)가 함께 쓴다([[#61]]).
 */
import { parseBreakdownAxis, type BreakdownAxis } from "./breakdown";
import { DEFAULT_CHURN_SORT, parseChurnSort, type ChurnSort } from "./teacher-churn";
import { DEFAULT_CHURN_VIEW, parseChurnView, type ChurnView } from "./teacher-churn-view";

export type WithdrawalTrendPrefs = { showTotal: boolean; kind: "bar" | "line"; axis: BreakdownAxis; churnSort: ChurnSort; churnView: ChurnView };
export const DEFAULT_WITHDRAWAL_TREND_PREFS: WithdrawalTrendPrefs = {
  showTotal: true, kind: "bar", axis: "subject", churnSort: DEFAULT_CHURN_SORT, churnView: DEFAULT_CHURN_VIEW,
};

export function parseWithdrawalTrendPrefs(raw: unknown): WithdrawalTrendPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    showTotal: o.trend_total !== "off", kind: o.trend_kind === "line" ? "line" : "bar", axis: parseBreakdownAxis(o.breakdown_axis),
    churnSort: parseChurnSort(o.churn_sort), churnView: parseChurnView(o.churn_view),
  };
}
