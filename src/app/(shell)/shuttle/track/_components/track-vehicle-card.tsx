"use client";

import { useMemo } from "react";
import { phoneLabel } from "@/lib/format/phone";
import { Pill } from "@/components/atoms/pill";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { runTitle } from "@/features/shuttle/types";
import { firstTime } from "@/features/shuttle/today/today-board";
import { progressLabel, type LiveVehicle } from "@/features/shuttle/live/live-board";
import { TRIP_STATE_LABEL, TRIP_TONE } from "@/features/shuttle/today/trip-state";

/**
 * 차 한 대 — 지금 상태 한 줄 + 이 차 노선 정류장의 좌표 준비 상태(지도는 화면 위에 하나로 둔다, 2026-10-08).
 *
 * ⚠️ 정류장 수 세기는 **이미 받아 둔 값 위의 표시용 계산**이다(도메인 집계가 아니라 지도 준비 상태).
 *    진행·상태 같은 도메인 숫자는 그대로 `live-board`에서 온다.
 */
export function TrackVehicleCard({
  vehicle,
  tripsReady,
  coordByStop,
}: {
  vehicle: LiveVehicle;
  tripsReady: boolean;
  coordByStop: Map<string, boolean>;
}) {
  /** 지금 도는 회차 — 여럿이면 첫 번째(차 한 대가 동시에 두 회차를 돌지는 않는다). */
  const running = vehicle.runs.find((r) => r.state === "running") ?? null;

  const stopCount = useMemo(() => {
    const ids = new Set<string>();
    for (const r of vehicle.runs) {
      for (const s of r.run.stops) if (s.stopId) ids.add(s.stopId);
    }
    let withCoords = 0;
    for (const id of ids) if (coordByStop.get(id)) withCoords += 1;
    return { total: ids.size, withCoords };
  }, [vehicle, coordByStop]);

  return (
    <section className="bg-card flex flex-col gap-2 rounded-2xl p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-foreground text-base font-bold">{vehicle.vehicleName}</h2>
        {vehicle.driverName && (
          <span className="text-text-dim text-xs">
            기사 {vehicle.driverName}
            {vehicle.driverPhone && (
              <a
                href={`tel:${vehicle.driverPhone}`}
                className="text-primary ml-1 font-bold underline"
              >
                {phoneLabel(vehicle.driverPhone)}
              </a>
            )}
          </span>
        )}
      </div>

      {/* 지금 상태 — 🔴 0243a가 없으면 상태를 말하지 않는다('운행 중 아님'은 사실이 아니라 "모른다"이다). */}
      {tripsReady && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {running ? (
            <>
              <Pill color={TONE_COLOR[TRIP_TONE.running]}>{TRIP_STATE_LABEL.running}</Pill>
              {firstTime(running.run) && (
                <span className="text-foreground num text-sm font-bold">
                  {firstTime(running.run)}
                </span>
              )}
              <span className="text-text-dim text-xs font-bold">{runTitle(running.run)}</span>
              <span className="text-text-faint num ml-auto text-xs font-bold">
                {progressLabel(running.progress)}
              </span>
            </>
          ) : (
            <span className="text-text-faint text-xs">운행 중 아님</span>
          )}
        </div>
      )}

      {/* 지도에 이 차 정류장이 몇 곳 찍히는지 — 지금 말할 수 있는 진짜 숫자다(차 위치는 아직 없다). */}
      {stopCount.total > 0 && (
        <p className="text-text-faint text-xs">
          이 차 노선 정류장 <span className="num font-bold">{stopCount.total}</span>곳 중{" "}
          <span className="num font-bold">{stopCount.withCoords}</span>곳이 지도에 표시됩니다
          {stopCount.withCoords === 0 && " — '노선 편성 → 정류장 관리'에서 위치를 찍을 수 있습니다"}
        </p>
      )}
    </section>
  );
}
