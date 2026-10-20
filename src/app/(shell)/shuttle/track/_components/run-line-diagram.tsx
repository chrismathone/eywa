"use client";

import { ACADEMY_LOCATION } from "@/features/shuttle/map/academy-location";
import { RouteLineDiagram } from "@/features/shuttle/map/components/route-line-diagram";
import { diagramBus } from "@/features/shuttle/map/route-progress";
import type { VehiclePosition } from "@/features/shuttle/map/vehicle-position";
import { firstTime } from "@/features/shuttle/today/today-board";
import { DIRECTION_LABEL, runShortTitle, type ShuttleRun } from "@/features/shuttle/types";

/**
 * 직원 '실시간 위치'의 회차 노선도 — 편성 회차(`ShuttleRun`)를 공용 버스 노선도(`RouteLineDiagram`)에 맞춰 넘긴다.
 * 🔑 정류장 순서·시각은 편성 그대로(`sortOrder` · `atTime`).
 * 🚌 그 회차가 운행 중이고 기사 폰 위치(0383a)가 있으면 노선 위 자리에 차를 얹는다(학원 칸 좌표 = 학원 위치).
 */
export function RunLineDiagram({
  run,
  active = false,
  onPick,
  coords,
  position,
  now,
}: {
  run: ShuttleRun;
  /** 지금 고른 회차 — 테두리로 표시. */
  active?: boolean;
  /** 누르면 그 회차를 고른다(호차를 고른 상태에서만 준다). */
  onPick?: () => void;
  /** 정류장 마스터 id → 좌표(좌표 있는 것만). */
  coords?: ReadonlyMap<string, { lat: number; lng: number }>;
  /** 이 회차의 최신 차 위치(운행 중일 때만 온다). */
  position?: VehiclePosition | null;
  /** 위치를 읽은 시각(ms) — "N초 전" 기준. */
  now?: number;
}) {
  const ordered = [...run.stops].sort((a, b) => a.sortOrder - b.sortOrder);
  const stops = ordered.map((s) => ({ id: s.id, kind: s.kind, name: s.stopName, time: s.atTime }));
  const bus =
    position && coords && now
      ? diagramBus(
          ordered.map((s) => {
            const c = s.kind === "stop" ? (s.stopId ? coords.get(s.stopId) : undefined) : ACADEMY_LOCATION;
            const name = s.kind === "depart" ? "학원 출발" : s.kind === "arrive" ? "학원 도착" : s.stopName;
            return { name, lat: c?.lat ?? null, lng: c?.lng ?? null };
          }),
          position,
          now,
        )
      : null;
  return (
    <RouteLineDiagram
      time={firstTime(run)}
      label={DIRECTION_LABEL[run.direction]}
      title={runShortTitle(run)}
      stops={stops}
      active={active}
      onPick={onPick}
      bus={bus}
    />
  );
}
