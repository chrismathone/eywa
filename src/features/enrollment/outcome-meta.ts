import type { PillColor } from "@/components/atoms/pill";

// 등록상담 진행 상태(시스템 고정 enum — 운영 enum 아님, 하드코딩 허용). 칸반 카드·테이블·필터·연동 카드 단일 소스.
// (app/(shell)/enrollment/_components/outcome-meta.ts에서 승격 — 그 파일은 re-export shim. features에서도 import 가능.)
export const OUTCOME_PILL: Record<string, { label: string; color: PillColor }> = {
  pending: { label: "대기", color: "amber" },
  scheduled: { label: "예약", color: "gold" },
  consulted: { label: "상담완료", color: "blue" },
  ai_done: { label: "AI 완료", color: "purple" },
  enrolled: { label: "등록", color: "green" },
  declined: { label: "거절", color: "neutral" },
  no_show: { label: "노쇼", color: "rose" },
};

export const OUTCOME_OPTIONS: { value: string; label: string }[] = Object.entries(OUTCOME_PILL).map(
  ([value, m]) => ({ value, label: m.label }),
);

export function outcomePill(key: string): { label: string; color: PillColor } {
  return OUTCOME_PILL[key] ?? OUTCOME_PILL.pending!;
}
