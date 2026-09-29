/**
 * 퇴원관리 '월별 추이' 보기 — `학원 전체` 막대 켜기/끄기 · 막대/꺾은선(원장 2026-09-29 *"전체 on/off 토글만들고, 대시보드처럼
 * 막대/꺾은선 전환 토글 추가"*). 계정 귀속(`users.ui_prefs.withdrawals`) · 기본값(켜짐·막대)은 저장하지 않는다.
 * ⚠️ 일반 모듈 — 서버(초기값)와 클라(토글)가 함께 쓴다([[#61]]).
 */
export type WithdrawalTrendPrefs = { showTotal: boolean; kind: "bar" | "line" };
export const DEFAULT_WITHDRAWAL_TREND_PREFS: WithdrawalTrendPrefs = { showTotal: true, kind: "bar" };

export function parseWithdrawalTrendPrefs(raw: unknown): WithdrawalTrendPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { showTotal: o.trend_total !== "off", kind: o.trend_kind === "line" ? "line" : "bar" };
}
