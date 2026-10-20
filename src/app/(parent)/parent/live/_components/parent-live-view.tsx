"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { AcademyLocation } from "@/features/shuttle/map/academy-location";
import { ParentLiveMap, type MapStop, type MapVehicle } from "@/features/shuttle/map/components/parent-live-map";
import { useVehiclePositions } from "@/features/shuttle/map/components/use-vehicle-positions";
import { getParentVehiclePositions } from "@/features/shuttle/map/server/vehicle-position-actions";
import { ageLabel, ageSeconds, STALE_AFTER_S } from "@/features/shuttle/map/vehicle-position";
import { diagramBus } from "@/features/shuttle/map/route-progress";
import { ROLE_LABEL, RouteLineDiagram } from "@/features/shuttle/map/components/route-line-diagram";
import type { ParentLiveLeg } from "@/features/shuttle/map/parent-live";
import { getParentRunRoadPath } from "@/features/shuttle/map/server/route-path";
import type { RunRoadPath } from "@/features/shuttle/map/server/route-path-core";
import { DIRECTION_LABEL } from "@/features/shuttle/types";

/**
 * 학부모 '실시간 차량' 화면 본체(사용자 2026-10-15) —
 * ① 제목 바로 아래 **버스 노선도**(고른 회차, 탈 곳 초록 · 내릴 곳 주황)
 * ② 지도: 그 회차 정류장(번호) + 도로 경로(나가는 길 / 돌아오는 길) + 탈 곳 / 내릴 곳 배지
 * ③ '오늘 타고 내리는 곳' — 아이 × 등원/하원 한 줄씩, **누르면 그 회차**로 ①·② 가 바뀐다.
 *
 * 🔑 처음엔 지금과 가까운 구간(서버가 `nearestLegKey`로 골라 넘긴다 — 서버·브라우저 시각 차로 첫 화면이 갈리지 않게).
 * 🔑 알림 때문에 15초마다 페이지를 다시 읽어도(router.refresh) 고른 구간·경로는 이 상태에 남는다.
 * 🚌 차 위치(0383a) — 고른 회차가 운행 중이고 기사 폰이 위치를 보내고 있을 때만 지도에 뜬다(10초마다 다시 읽음).
 *    서버가 **우리 아이 회차만** 돌려준다. 없으면 지어내지 않고 "아직"이라고 말한다.
 */
export function ParentLiveView({
  appKey,
  academy,
  legs,
  initialKey,
}: {
  appKey: string;
  academy: AcademyLocation;
  legs: ParentLiveLeg[];
  initialKey: string | null;
}) {
  const [pickKey, setPickKey] = useState(initialKey);
  const leg = legs.find((l) => l.key === pickKey) ?? legs[0] ?? null;
  const [roads, setRoads] = useState<Record<string, RunRoadPath>>({});

  const runId = leg?.runId ?? null;
  const hasRoad = runId !== null && runId in roads;
  useEffect(() => {
    if (!runId || hasRoad) return;
    let cancelled = false;
    getParentRunRoadPath(runId)
      .then((result) => {
        if (!cancelled) setRoads((prev) => ({ ...prev, [runId]: result }));
      })
      .catch(() => {
        if (!cancelled) setRoads((prev) => ({ ...prev, [runId]: { ok: false, error: "경로를 불러오지 못했습니다" } }));
      });
    return () => {
      cancelled = true;
    };
  }, [runId, hasRoad]);

  const road = runId ? roads[runId] : undefined;

  const { positions, now } = useVehiclePositions(getParentVehiclePositions);
  const pos = positions.find((p) => p.runId === runId) ?? null;
  const posAge = pos ? ageSeconds(pos.receivedAt, now) : null;
  const mapVehicles: MapVehicle[] =
    pos && leg && posAge !== null
      ? [{ key: pos.runId, label: leg.vehicleName, lat: pos.lat, lng: pos.lng, age: ageLabel(posAge), stale: posAge > STALE_AFTER_S }]
      : [];

  // 🚌 노선도 위 차 위치 — 지도와 같은 GPS를 노선 칸 위 자리로 바꾼다(route-progress.ts).
  const placeOf = (r: { kind: string; name: string }) => (r.kind === "depart" ? "학원 출발" : r.kind === "arrive" ? "학원 도착" : r.name);
  const lineBus =
    pos && leg ? diagramBus(leg.route.map((r) => ({ ...r, name: placeOf(r) })), pos, now) : null;

  // 지도 정류장 — 정류장 칸은 순서 번호를 붙이고, 학원 칸은 탈 곳/내릴 곳일 때만(아니면 학원 배지가 대신한다).
  const stopIds = (leg?.route ?? []).filter((r) => r.kind === "stop").map((r) => r.id);
  const mapStops: MapStop[] = (leg?.route ?? []).flatMap((r) => {
    if (r.kind !== "stop" && !r.role) return [];
    const name = r.kind === "stop" ? `${stopIds.indexOf(r.id) + 1}. ${r.name}` : r.kind === "depart" ? `학원 출발` : `학원 도착`;
    return [{ stopId: r.id, name, lat: r.lat, lng: r.lng, ...(r.role ? { role: r.role } : {}) }];
  });
  const noCoords = (leg?.route ?? []).filter((r) => r.kind === "stop" && r.lat === null).map((r) => r.name);
  const board = leg?.route.find((r) => r.role === "board");
  const alight = leg?.route.find((r) => r.role === "alight");
  const placeName = (r: NonNullable<typeof board>) => (r.kind === "depart" ? "학원 출발" : r.kind === "arrive" ? "학원 도착" : r.name);

  return (
    <>
      {leg ? (
        <RouteLineDiagram
          time={leg.route.find((r) => r.time)?.time?.slice(0, 5) ?? ""}
          label={`${leg.kidName} ${DIRECTION_LABEL[leg.direction]}`}
          title={`${leg.vehicleName} ${leg.runName}`}
          stops={leg.route.map((r) => ({ id: r.id, kind: r.kind, name: r.name, time: r.time, ...(r.role ? { role: r.role } : {}) }))}
          bus={lineBus}
        />
      ) : null}

      {appKey ? (
        <ParentLiveMap
          appKey={appKey}
          academy={academy}
          stops={mapStops}
          paths={road?.ok ? road.legs.map((l) => ({ path: l.path, kind: l.kind })) : []}
          vehicles={mapVehicles}
        />
      ) : (
        <section className="bg-card rounded-2xl p-6 text-center shadow-[var(--shadow-card)]">
          <p className="font-bold">준비 중인 기능이에요</p>
          <p className="text-text-dim mt-1 text-sm break-keep">아이가 탄 셔틀이 지금 어디쯤인지 지도로 볼 수 있게 준비하고 있어요.</p>
        </section>
      )}

      {leg ? (
        <div className="text-text-dim flex flex-col gap-0.5 px-1 text-xs break-keep">
          {board || alight ? (
            <p className="font-bold">
              {board ? <span className="text-green">{ROLE_LABEL.board} {placeName(board)}{board.time ? ` ${board.time.slice(0, 5)}` : ""}</span> : null}
              {board && alight ? " → " : null}
              {alight ? <span className="text-amber">{ROLE_LABEL.alight} {placeName(alight)}{alight.time ? ` ${alight.time.slice(0, 5)}` : ""}</span> : null}
            </p>
          ) : null}
          {road?.ok ? <p>🛣️ 회차 전체 {(road.distanceM / 1000).toFixed(1)}km · 약 {Math.round(road.durationS / 60)}분 (정차 시간 제외)</p> : null}
          {noCoords.length > 0 ? <p className="text-text-faint">지도에 위치가 아직 없는 정류장: {noCoords.join(", ")}</p> : null}
        </div>
      ) : null}

      <p className="bg-bg-soft text-text-dim rounded-xl px-3 py-2 text-xs break-keep">
        {pos && posAge !== null
          ? posAge > STALE_AFTER_S
            ? `🚌 차 위치가 ${ageLabel(posAge)}부터 갱신되지 않고 있어요. 신호가 약한 곳일 수 있어요.`
            : `🚌 ${leg?.vehicleName ?? "차"} 위치 · ${ageLabel(posAge)} 기준이에요. 10초마다 새로 고쳐요.`
          : leg?.trip === "running"
            ? "🚌 운행 중이에요. 기사님 폰에서 위치가 오면 지도에 차가 떠요."
            : "🚌 차가 출발하면 지도에 차 위치가 떠요. 지도의 길은 오늘 운행 계획이에요."}
      </p>

      <section className="bg-card rounded-2xl p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-bold">오늘 타고 내리는 곳</h2>
        {legs.length === 0 ? (
          <p className="text-text-dim mt-2 text-sm">오늘은 셔틀 일정이 없어요.</p>
        ) : (
          <>
            <p className="text-text-faint mt-0.5 text-xs">누르면 그 회차 노선이 지도에 떠요.</p>
            <ul className="mt-2 flex flex-col gap-2">
              {legs.map((l) => {
                const active = l.key === leg?.key;
                return (
                  <li key={l.key}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPickKey(l.key)}
                      className={cn(
                        "flex min-h-11 w-full cursor-pointer flex-col rounded-xl border px-3 py-2 text-left",
                        active ? "border-primary bg-primary/5" : "border-line hover:bg-muted",
                      )}
                    >
                      <span className="text-sm font-bold">
                        {l.stopName}
                        {l.time ? <span className="num ml-1.5">{l.time.slice(0, 5)}</span> : null}
                      </span>
                      <span className="text-text-dim text-xs">
                        {l.kidName} {DIRECTION_LABEL[l.direction]} · {l.vehicleName} {l.runName}
                        {l.direction === "in" ? " · 여기서 타요" : " · 여기서 내려요"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
