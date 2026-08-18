/**
 * 수납 상태 색 — **앱 전체 단일 소스**(순수 상수, 서버/클라 공용).
 *
 * 2026-08-18 실측: 수납엔 색 정본이 아예 없었고(`features/billing`·`features/payroll`에 색 상수 export 0개)
 * 그래서 **한 화면 안에서도 갈렸다** — 학생 상세 수납 탭이 표 배지는 '미납'을 빨강으로, 바로 위 요약
 * 카드와 경고 배너는 같은 '미납'을 앰버로 그렸다(스크롤 한 번에 두 색). 앱 전체로 넓히면 미납 3색
 * (danger / amber / chart-4) · 완납 4색(chart-2 / primary / green / blue)이었다.
 *
 * 뜻은 의미색 캐논(src/lib/design/semantic-color.ts):
 *   완납 = positive · 부분납 = caution(아직 받을 게 남았다) · 미납/연체 = critical ·
 *   환불·무효 = inert(끝난 건이라 색을 뺀다).
 *
 * 🔑 **미납이 앰버가 아니라 빨강인 이유**: 부분납과 미납이 같은 앰버면 "일부라도 받았는가"가 색에서
 * 사라진다. 돈은 그 구분이 핵심이라 단계를 나눈다(캐논의 caution↔critical 경계 = 지금 손을 대야 하나).
 */
export type BillingStatusKey = "paid" | "partial" | "unpaid" | "refunded" | "void";

export const BILLING_LABEL: Record<BillingStatusKey, string> = {
  paid: "납부완료",
  partial: "부분납부",
  unpaid: "미납",
  refunded: "환불",
  void: "무효",
};

/** 표 배지·칩 — 옅은 틴트 + 같은 색 글자 + 테두리. */
export const BILLING_BADGE: Record<BillingStatusKey, string> = {
  paid: "text-green bg-green-soft border-green/25",
  partial: "text-amber bg-amber-soft border-amber/25",
  unpaid: "text-danger bg-danger-soft border-danger/25",
  refunded: "text-text-dim bg-bg-soft border-line",
  void: "text-text-faint bg-bg-soft border-line",
};

/** 요약 카드(연한 판 + 테두리 + 진한 숫자) — 배지보다 넓은 면이라 채움을 더 옅게. */
export const BILLING_CARD: Record<BillingStatusKey, string> = {
  paid: "bg-green/5 border-green/25 text-green",
  partial: "bg-amber/5 border-amber/25 text-amber",
  unpaid: "bg-danger/5 border-danger/25 text-danger",
  refunded: "bg-bg-soft border-line text-text-dim",
  void: "bg-bg-soft border-line text-text-faint",
};

/** 진행률 바·막대 등 솔리드 채움. */
export const BILLING_SOLID: Record<BillingStatusKey, string> = {
  paid: "bg-green",
  partial: "bg-amber",
  unpaid: "bg-danger",
  refunded: "bg-text-faint",
  void: "bg-text-faint",
};
