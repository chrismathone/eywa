import { describe, expect, it } from "vitest";
import { buildGoalRail } from "./goal-rail";
import { sortBySlow } from "./student-order";

const DAYS = ["2026-08-03", "2026-08-06", "2026-08-10", "2026-08-13"];
const row = (name: string, goalEnd: number | null, now: number | null) => ({
  name,
  rails:
    now == null && goalEnd == null
      ? []
      : [
          {
            rail: buildGoalRail({
              startBefore: 470,
              goalEnd,
              points: now == null ? [] : [{ date: "2026-08-06", position: now }],
              dayDates: DAYS,
              today: "2026-08-06",
            }),
          },
        ],
});

describe("sortBySlow — 느린 순", () => {
  it("느림 → 계획대로 → 빠름 → 목표 도달 → 목표 없음 → 위치 미상, 같은 상태면 더 느린 쪽 먼저", () => {
    // Start 470 · End 490 · 4일 중 2일 지남 → Plan 480.
    const rows = [
      row("빠름", 490, 486),
      row("위치미상", null, null),
      row("느림2", 490, 476),
      row("도달", 490, 491),
      row("목표없음", null, 475),
      row("계획대로", 490, 480),
      row("느림4", 490, 474),
    ];
    expect(sortBySlow(rows).map((r) => r.name)).toEqual([
      "느림4",
      "느림2",
      "계획대로",
      "빠름",
      "도달",
      "목표없음",
      "위치미상",
    ]);
  });

  it("🔴 원본을 건드리지 않고, 같은 키는 명단 순을 지킨다(안정 정렬)", () => {
    const rows = [row("가", 490, 480), row("나", 490, 480), row("다", 490, 480)];
    const sorted = sortBySlow(rows);
    expect(sorted.map((r) => r.name)).toEqual(["가", "나", "다"]);
    expect(rows.map((r) => r.name)).toEqual(["가", "나", "다"]);
    expect(sorted).not.toBe(rows);
  });
});
