import { chipProps } from "@/features/calendar/color";
import type { CalendarColor } from "@/features/calendar/types";
import type { UnifiedKind } from "./model";

/**
 * 시험 종류 → 색 **단일 소스**. 원장·달력 칩·종류별 막대·범례가 전부 여기서 색을 받는다
 * (한 화면 안에서 '일일테스트'가 곳마다 다른 색이면 이어진다는 느낌이 끊긴다 — 의미색 캐논의 "일치하는 곳은 항상 일치").
 * 칩 모양은 캘린더 탭의 `chipProps`를 그대로 쓴다.
 */
export const KIND_COLOR: Record<UnifiedKind, CalendarColor> = {
  daily: "blue", check: "purple", admission: "green", school: "amber", monthly: "rose", other: "neutral",
};

/** 막대·점처럼 면을 칠하는 자리 — 정적 클래스(동적 조립 금지). */
export const KIND_SOLID: Record<UnifiedKind, string> = {
  daily: "bg-blue", check: "bg-purple", admission: "bg-green", school: "bg-amber", monthly: "bg-rose", other: "bg-neutral-fill",
};

export function kindChip(kind: UnifiedKind) {
  return chipProps(KIND_COLOR[kind]);
}

/** 100점 환산 점수의 글자색 — 90↑ 초록 · 60 미만 빨강 · 그 사이 잉크. */
export function percentTone(pct: number | null): string {
  if (pct == null) return "text-text-dim";
  if (pct >= 90) return "text-green";
  if (pct < 60) return "text-danger";
  return "text-foreground";
}
