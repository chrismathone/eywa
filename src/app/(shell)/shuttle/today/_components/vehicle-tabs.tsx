"use client";

import { SHUTTLE_CHIP, SHUTTLE_CHIP_OFF, SHUTTLE_CHIP_ON } from "@/features/shuttle/control-size";
import type { Progress, VehicleGroup } from "@/features/shuttle/today/today-board";

/**
 * 호차 토글 — `[전체] [1호차] [2호차]` (사용자 2026-10-20 *"등하원으로 나누지말고 호차 별로 나눠서 토글 형태로 누르면
 * 계속 그 호차면 볼수있게 왔다갔다로"*). 옛 `등하원: 전체` 드롭다운 자리다.
 *
 * 🔑 칩 옆 숫자 = 그 차의 **아직 안 찍은 수**(호차 머리와 같은 `progress.unmarked`) — 다른 차로 가 보지 않아도 남은 일이 보인다.
 * ⚠️ 모양은 실시간 위치 면의 호차 고르기와 같은 셔틀 칩 캐논(폰 44px · control-size.ts).
 */
export function VehicleTabs({
  groups,
  progressByKey,
  value,
  onPick,
}: {
  /** 그날 도는 호차 전부(고르기 전 목록). */
  groups: readonly VehicleGroup[];
  progressByKey: ReadonlyMap<string, Progress>;
  /** 고른 호차 칸 키 — null이면 전체. */
  value: string | null;
  onPick: (key: string | null) => void;
}) {
  if (groups.length < 2) return null;
  const tabs = [{ key: null, name: "전체", left: 0 }, ...groups.map((g) => ({ key: g.key, name: g.vehicleName, left: progressByKey.get(g.key)?.unmarked ?? 0 }))];
  return (
    <div role="tablist" aria-label="호차 선택" className="flex flex-wrap gap-1.5">
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button
            key={t.key ?? "all"}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(t.key)}
            className={`${SHUTTLE_CHIP} px-4 ${on ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF}`}
          >
            {t.name}
            {t.left > 0 && (
              <span className={`num text-xs ${on ? "opacity-80" : "text-amber"}`} title={`${t.left}명 남음`}>
                {t.left}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
