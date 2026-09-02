/**
 * MCS 월간 뷰의 **행 순서** — 세 보기(진도표·진도 레일·현황 표)가 같은 순서를 쓴다. 순수(Vitest).
 *
 * 원장 2026-09-02 *"어떤 탭을 고르던 해당 학생의 행높이가 똑같아서 전환이 자연스러워 보이도록"* —
 * 높이만이 아니라 **순서**도 같아야 눈이 같은 줄에 머문다. 그래서 '느린 순'은 현황 표의 것이 아니라
 * 툴바의 것이고, 켜면 세 보기가 함께 정렬된다.
 *
 * 순서는 대표 레일(`pickPrimaryRail`)의 상태 순위 → 같은 상태면 차이(diff) 오름차순(더 느린 쪽 먼저)
 * → 나머지는 명단 순 그대로(안정 정렬).
 */
import { pickPrimaryRail, type GoalRail, type GoalRailStatus } from "./goal-rail";

export const STATUS_RANK: Record<GoalRailStatus, number> = {
  behind: 0,
  on: 1,
  ahead: 2,
  done: 3,
  "not-started": 4,
  "goal-behind": 5,
  "no-goal": 6,
  "no-data": 7,
};

export function sortBySlow<T extends { rails: readonly { rail: GoalRail }[] }>(rows: readonly T[]): T[] {
  const keyOf = (r: T) => {
    const rail = pickPrimaryRail(r.rails)?.rail;
    return { rank: STATUS_RANK[rail?.status ?? "no-data"], diff: rail?.diff ?? 0 };
  };
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka.rank !== kb.rank) return ka.rank - kb.rank;
    return ka.diff - kb.diff;
  });
}
