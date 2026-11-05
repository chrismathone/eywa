import type { CSSProperties } from "react";

/**
 * 열 수는 **실제로 선 카드 수**에서 나온다(D2) — 역할에 따라 5칸이면 5열, 빈 칸을 만들지 않는다.
 * 넓을 때 n열 · 중간 폭은 n≤3이면 n열, 4면 2열, 그 이상 3열(남는 자리는 마지막 카드가 채운다) ·
 * 좁을 때 2열(홀수 번째 마지막 카드는 CSS가 두 칸으로).
 * 순수 모듈로 둔다 — 실제 띠(`kpi-strip.tsx`, 클라)와 서버 스켈레톤(`overview-skeleton.tsx`)이 같은 함수를 부른다.
 */
export function kpiGridVars(n: number): CSSProperties {
  // 8칸(금일 등록 포함)은 4 × 2 — 3열이면 3·3·2로 마지막 줄만 넓어진다. 9칸(강좌수, 원장 2026-10-20)은 3 × 3.
  const mid = n === 4 ? 2 : n === 8 ? 4 : Math.max(1, Math.min(n, 3));
  const rest = n % mid;
  return {
    "--kpi-n": Math.max(1, n),
    "--kpi-mid": mid,
    "--kpi-last-mid": rest === 0 ? "auto" : `span ${mid - rest + 1}`,
  } as CSSProperties;
}
