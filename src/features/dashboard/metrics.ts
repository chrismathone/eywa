import type { EywaIconName } from "@/components/icons/eywa-icons";
import type { PillColor } from "@/components/atoms/pill";

/**
 * 대시보드 커맨드센터 순수 계산 — 표현 컴포넌트에서 분리(테스트 강제). RLS·DB 무관.
 */

export type ActionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  color: PillColor;
  icon: EywaIconName;
};

/** 이번 달 순증감(신규 - 퇴원). */
export function enrollmentDelta(newCount: number, withdrawn: number): number {
  return newCount - withdrawn;
}

/**
 * '처리 필요' 액션 스택 — count > 0 인 항목만, 우선순위 순서(미수→결석→AI→신규).
 * 전부 0이면 빈 배열(빈 상태 = "모두 정리됨").
 */
export function buildActionItems(input: {
  unpaidCount?: number;
  absenceRisk: number;
  aiWaiting: number;
  newConsults: number;
}): ActionItem[] {
  const all: ActionItem[] = [
    {
      key: "unpaid",
      label: "미수금",
      count: input.unpaidCount ?? 0,
      href: "/billing",
      color: "danger",
      icon: "pollen",
    },
    {
      key: "absence",
      label: "결석 위험",
      count: input.absenceRisk,
      href: "/students",
      color: "amber",
      icon: "pulse",
    },
    {
      key: "ai",
      label: "AI 상담 대기",
      count: input.aiWaiting,
      href: "/enrollment",
      color: "gold",
      icon: "sparkle",
    },
    {
      key: "new",
      label: "신규 등록상담",
      count: input.newConsults,
      href: "/enrollment",
      color: "blue",
      icon: "sprout",
    },
  ];
  return all.filter((i) => i.count > 0);
}

/** 시계열 변화량(마지막 - 처음). 점이 2개 미만이면 0. */
export function trendDelta(points: number[]): number {
  if (points.length < 2) return 0;
  return points[points.length - 1] - points[0];
}
