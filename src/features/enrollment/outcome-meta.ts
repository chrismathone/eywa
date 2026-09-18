import type { PillColor } from "@/components/atoms/pill";

// 등록상담 진행 상태(시스템 고정 enum — 운영 enum 아님, 하드코딩 허용). 칸반 카드·테이블·필터·연동 카드 단일 소스.
// (app/(shell)/enrollment/_components/outcome-meta.ts에서 승격 — 그 파일은 re-export shim. features에서도 import 가능.)
export const OUTCOME_PILL: Record<string, { label: string; color: PillColor }> = {
  pending: { label: "대기", color: "amber" },
  scheduled: { label: "예약", color: "gold" },
  consulted: { label: "상담완료", color: "blue" },
  ai_done: { label: "AI 완료", color: "purple" },
  enrolled: { label: "재원생 등록 완료", color: "green" }, // 원장 2026-09-18 "재원생 등록 -> 재원생 등록 완료"
  declined: { label: "거절", color: "neutral" },
  no_show: { label: "노쇼", color: "rose" },
};

export const OUTCOME_OPTIONS: { value: string; label: string }[] = Object.entries(OUTCOME_PILL).map(
  ([value, m]) => ({ value, label: m.label }),
);

export function outcomePill(key: string): { label: string; color: PillColor } {
  return OUTCOME_PILL[key] ?? OUTCOME_PILL.pending!;
}

/**
 * outcome → 배지 클래스(틴트+글자+테두리). **Pill을 못 쓰는 자리**(상세 헤더의 커스텀 배지 등)용.
 *
 * 🔴 상세 화면이 자기 맵(`OUTCOME_BADGE`)을 들고 있었는데 chart 슬롯을 직접 참조해 **같은 상태가 다른
 * 색**이었다(2026-08-18 실측): 'AI 완료'가 목록에선 보라(purple)인데 상세에선 초록(chart-2)이라
 * 재원생 등록과 구분되지 않았고, '대기'와 '예약'도 상세에선 같은 색이라 두 단계가 붙어 보였다.
 * 색은 여기 한 곳에서만 나온다 — 화면에서 outcome 색 맵을 새로 만들지 말 것.
 */
const OUTCOME_CLASS: Record<PillColor, string> = {
  primary: "text-primary bg-primary-soft border-primary/25",
  green: "text-green bg-green-soft border-green/25",
  gold: "text-gold bg-gold-soft border-gold/25",
  blue: "text-blue bg-blue-soft border-blue/25",
  purple: "text-purple bg-purple-soft border-purple/25",
  rose: "text-rose bg-rose-soft border-rose/25",
  amber: "text-amber bg-amber-soft border-amber/25",
  danger: "text-danger bg-danger-soft border-danger/25",
  neutral: "text-text-dim bg-bg-soft border-line",
};

export function outcomeBadge(key: string): { label: string; class: string } {
  const m = outcomePill(key);
  return { label: m.label, class: OUTCOME_CLASS[m.color] };
}
