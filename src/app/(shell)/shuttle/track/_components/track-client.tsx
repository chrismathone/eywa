"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStopLocation } from "@/features/shuttle/server/actions";
import Link from "next/link";
import { FaceTabs } from "@/components/face-tabs";
import { Pill } from "@/components/atoms/pill";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { kstMinutesOfDay, kstTimeOf } from "@/lib/date-kst";
import {
  hasCoords,
  runShortTitle,
  type Season,
  type ShuttleRun,
  type ShuttleStop,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import { SHUTTLE_CHIP, SHUTTLE_CHIP_OFF, SHUTTLE_CHIP_ON, SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";
import { SHUTTLE_TRACK_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { mergePlanAndLog, plannedRidesOn, type RideException } from "@/features/shuttle/roster";
import { firstTime, groupRunsByVehicle } from "@/features/shuttle/today/today-board";
import { buildLiveBoard, nearestRunId, summarizeLive } from "@/features/shuttle/live/live-board";
import { useShuttleLive } from "@/features/shuttle/live/use-shuttle-live";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import { TrackVehicleCard } from "./track-vehicle-card";
import { TrackRunDetail } from "./track-run-detail";
import { RunLineDiagram } from "./run-line-diagram";
import { getRunRoadPath } from "@/features/shuttle/map/server/route-path";
import type { RunRoadPath } from "@/features/shuttle/map/server/route-path-core";

import { ParentLiveMap, type MapStop, type MapVehicle } from "@/features/shuttle/map/components/parent-live-map";
import { useVehiclePositions } from "@/features/shuttle/map/components/use-vehicle-positions";
import { getStaffVehiclePositions } from "@/features/shuttle/map/server/vehicle-position-actions";
import { ageLabel, ageSeconds, STALE_AFTER_S } from "@/features/shuttle/map/vehicle-position";
import { ACADEMY_LOCATION } from "@/features/shuttle/map/academy-location";
import { liveLegPath, type LiveLeg } from "@/features/shuttle/map/live-leg";
import { ShuttleDayNav } from "../../_components/shuttle-day-nav";

/** 빌드에 박히는 값 — 없으면 지도 대신 안내만(학부모 '실시간 차량'과 같은 판정). */
const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

/**
 * 실시간 위치 — 위에 **카카오 지도 하나**(학원 + 그날 도는 노선 정류장, 2026-10-08) + **차 한 대 = 카드 하나**.
 *
 * 원장(2026-09-03): *"운행현황 옆에 버튼하나 더해서 실시간 위치 만들어서 쓸수있게 해주고"* +
 * *"지도키는 추후 개발예정이라 잡고 **영역만 만들어두려는것**"*.
 *
 * 🔴 **지금은 자리를 잡는 화면이다.** 위치를 보내는 기능도, 지도 키도 아직 없다 — 그래서 이 화면은
 *    차량 위치를 **아는 척하지 않고**(차 마커 없음), 무엇이 더 있어야 채워지는지를 한 번 말한다.
 * 🔴 **집계를 여기서 손으로 세지 않는다** — 묶음·진행은 `today-board`, 상태 겹치기는 `live-board`가
 *    한다(Vitest). 운행 현황 탭과 **같은 숫자**여야 어느 쪽이 진실인지 묻지 않게 된다.
 * 🔑 **찍는 버튼이 없다**(읽기 전용) — 출발/종료·탑승 체크는 전부 `/shuttle/today`에 있다.
 */
export function TrackClient({
  tenantId,
  date,
  season,
  vehicles,
  runs,
  logs,
  exceptions,
  stops,
  trips,
  tripsReady,
  today,
  canEditStops,
}: {
  tenantId: string;
  date: string;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  logs: BoardingLog[];
  exceptions: RideException[];
  /** 정류장 마스터 — 좌표(0244a)가 실려 온다. 지도 준비 상태를 세는 재료다. */
  stops: ShuttleStop[];
  /** 그날 회차별 운행 기록(0243a). Map은 서버→클라 경계를 못 넘어 **엔트리 배열**로 받는다. */
  trips: [string, ShuttleTrip][];
  /** 0243a 적용 여부. false면 운행 상태를 **아예 안 그린다**([[#95]]). */
  tripsReady: boolean;
  /** KST 오늘(서버가 내려준다) — 지난 날짜면 실시간 채널을 안 연다. */
  today: string;
  /**
   * 정류장 위치를 고칠 수 있나 — page.tsx가 저장 액션(`saveStopLocation`의 `gate()`)과 **같은 함수**
   * `canWriteTenant(shuttle)`로 계산한 값. 없으면 [위치 수정]을 그리지 않는다(원장 2026-11-05 — 예전엔 핀을 끌어 놓아야 거절됐다).
   */
  canEditStops: boolean;
}) {
  // 남이 찍으면 이 화면이 스스로 갱신된다. 🔴 publish는 안 한다 — 여기선 아무것도 바꾸지 않는다.
  const { lastSignalAt } = useShuttleLive({
    tenantId,
    date,
    enabled: Boolean(tenantId) && date === today,
  });

  const tripsByRun = useMemo(() => new Map(trips), [trips]);

  /** 회차별 그날 줄 — 예정 × 기록(운행 현황·오늘 등하원과 **같은 함수**를 탄다). */
  const byRun = useMemo(() => {
    const logsByRun = new Map<string, BoardingLog[]>();
    for (const l of logs) {
      if (!l.runId) continue;
      const list = logsByRun.get(l.runId) ?? [];
      list.push(l);
      logsByRun.set(l.runId, list);
    }
    // 🔑 **편성된 회차 전부**를 싣는다(사용자 2026-10-14 "호차별로 있는 노선들 다 가져와") — 운행 현황과 달리 이 면은
    //    노선을 보는 곳이라, 그날 타는 아이가 없는 회차(예: 시각 없는 3회차)도 회차 칩·정류장이 보여야 한다.
    //    탑승 없는 회차는 진행 0/0 · 경보 없음으로 접힌다(live-board 판정 그대로).
    return runs.map((run) => ({
      run,
      rows: mergePlanAndLog(plannedRidesOn(run, date, exceptions), logsByRun.get(run.id) ?? []),
    }));
  }, [runs, logs, date, exceptions]);

  const board = useMemo(
    () => buildLiveBoard(groupRunsByVehicle(byRun, vehicles), tripsByRun),
    [byRun, vehicles, tripsByRun],
  );
  const summary = useMemo(() => summarizeLive(board), [board]);

  /** 정류장 → 좌표 있음? 판정은 손으로 하지 않고 `hasCoords`(0244a check와 같은 규칙). */
  const coordByStop = useMemo(
    () => new Map(stops.map((s) => [s.id, hasCoords(s)])),
    [stops],
  );

  /**
   * 🔑 **호차 → 회차** 고르기(사용자 2026-10-08 "각 호차별로 나눌 수 있게 · 회차별 데이터도"). 'all'이면 종전처럼 차 카드 전부.
   *    호차를 고르면 그 차의 회차 칩 + 고른 회차의 정류장·아이들, 지도도 그 범위로 좁힌다. 화면 안 상태라 새로고침하면 '전체'.
   */
  const [vehicleId, setVehicleId] = useState<string>("all");
  const [runPick, setRunPick] = useState<string | null>(null);
  const vehicle = vehicleId === "all" ? null : board.find((v) => v.vehicleId === vehicleId) ?? null;
  // 회차를 안 골랐으면 **지금 도는 회차**, 없으면 첫 회차를 보여 준다(고르기 전에도 빈 화면이 아니게).
  const runId = vehicle
    ? (vehicle.runs.find((r) => r.run.id === runPick) ?? vehicle.runs.find((r) => r.state === "running") ?? vehicle.runs[0])?.run.id ?? null
    : null;
  /**
   * **이동 경로**(사용자 2026-10-14 "지도에 차가 어떻게 이동할지 이 노선에 맞게") — 카카오 길찾기로 구한 도로 위 경로.
   * 🔑 호차만 눌러도 그 차의 노선들(정류장 좌표가 하나라도 있는 회차) 경로가 다 뜬다. 회차를 고르면 그 회차만.
   * 🔑 회차마다 한 번만 묻는다(실시간 신호로 화면이 다시 그려져도 다시 안 묻는다 — 서버도 10분 캐시).
   */
  const coordStopIds = useMemo(() => new Set(stops.filter((s) => hasCoords(s)).map((s) => s.id)), [stops]);
  /** 정류장 id → 좌표 — 노선도 위 🚌 자리 계산용. */
  const coordById = useMemo(
    () => new Map(stops.flatMap((s) => (hasCoords(s) ? [[s.id, { lat: s.lat, lng: s.lng }] as const] : []))),
    [stops],
  );
  const routeRunIds = useMemo(() => {
    if (!vehicle) return [];
    const runs = runPick ? vehicle.runs.filter((r) => r.run.id === runPick) : vehicle.runs;
    return runs.filter((r) => r.run.stops.some((st) => st.stopId && coordStopIds.has(st.stopId))).map((r) => r.run.id);
  }, [vehicle, runPick, coordStopIds]);
  const [roads, setRoads] = useState<Record<string, RunRoadPath>>({});
  /** 경로를 **다시 받아 오라는** 신호 — 정류장 위치를 옮기면 올린다(사용자 2026-10-21 "위치수정을 하면 노선도 다시 짜줘"). */
  const [roadsRev, setRoadsRev] = useState(0);
  const routeKey = routeRunIds.join(",");
  useEffect(() => {
    let alive = true;
    for (const id of routeKey ? routeKey.split(",") : []) {
      getRunRoadPath(id).then((result) => {
        if (alive) setRoads((prev) => (prev[id] ? prev : { ...prev, [id]: result }));
      });
    }
    return () => {
      alive = false;
    };
  }, [routeKey, roadsRev]);
  const routeRows = routeRunIds.map((id) => ({ run: vehicle?.runs.find((r) => r.run.id === id) ?? null, result: roads[id] ?? null }));

  /**
   * 호차를 누르면 **지금 시각과 가장 가까운 회차**를 바로 편다(사용자 2026-10-14) — 운행 중이면 그 회차, 아니면 출발 시각이
   * 가장 가까운 회차(`nearestRunId`). 그래서 노선도·지도·경로가 그 회차 하나로 뜬다. [전체]는 고른 회차를 비운다.
   */
  function pickVehicle(id: string) {
    setVehicleId(id);
    const v = board.find((x) => x.vehicleId === id);
    setRunPick(v ? nearestRunId(v.runs, kstMinutesOfDay()) : null);
  }

  /**
   * 지도에 찍을 정류장 — 전체: 없음(학원만) · 호차: 그 차 노선 전체 · 직접 고른 회차: 그 회차(순서 번호). 좌표가 있는 것만.
   * 🔑 도는 회차는 위 `board`(운행 현황과 같은 계산)에서 온다 — 아무도 안 타는 노선의 정류장까지 늘어놓지 않는다.
   * 🔑 회차를 골랐으면 **노선 순서 번호**를 이름 앞에 붙인다("2. 칠성초 정문") — 지도에서 도는 순서가 읽힌다.
   */
  /**
   * ✏️ **위치 수정 모드**(사용자 2026-10-21) — 지도의 정류장을 끌어 옮기면 바로 저장(기존 saveStopLocation, 주소·반경은 그대로 실어
   * 보낸다 — 빼면 지워진다). 이름은 안 바뀐다. 저장 뒤엔 도로 경로를 다시 받는다(좌표가 바뀌었으니 옛 경로가 틀린다).
   */
  const router = useRouter();
  const [editStops, setEditStops] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  function moveStop(mapStopId: string, lat: number, lng: number) {
    const id = mapStopId.split("#")[0]!;
    const st = stops.find((x) => x.id === id);
    if (!st) return;
    const fd = new FormData();
    fd.set("id", id);
    fd.set("lat", lat.toFixed(7));
    fd.set("lng", lng.toFixed(7));
    fd.set("address", st.address ?? "");
    if (st.radiusM) fd.set("radiusM", String(st.radiusM));
    setEditMsg(null);
    startSaving(async () => {
      const res = await saveStopLocation(fd);
      if (res && "error" in res && res.error) setEditMsg(res.error);
      else {
        setEditMsg(`${st.name} 위치를 옮겼습니다`);
        // 🔑 옛 경로를 비우고 **다시 받는다** — 비우기만 하면 routeKey가 그대로라 아무도 다시 안 물어 경로가 사라진 채 남았다.
        //    서버 길찾기 캐시는 좌표 조합이 키라 옮긴 좌표로 새로 계산된다. 노선도(정류장 좌표)는 refresh로 따라온다.
        setRoads({});
        setRoadsRev((v) => v + 1);
        router.refresh();
      }
    });
  }
  /**
   * 🚏 **정류장을 누르면 그 정류장에서 다음 정류장까지만**(사용자 2026-10-21) — [전체 코스 보기]로 되돌린다.
   * 구간 찾기는 길찾기 결과의 `legStarts`(구간 시작 정류장 이름)로 한다.
   */
  const [focusStopId, setFocusStopId] = useState<string | null>(null);
  /**
   * 📍 **위치 없는 정류장 찍기**(사용자 2026-10-22 "수정모드에서 지정 안 된 곳을 마커로 찍을 수 있게") — 고른 호차(·회차)의 노선 중
   * 좌표가 없는 정류장. 하나를 고르고 지도를 누르면 그 자리로 저장한다(moveStop과 같은 저장 경로).
   */
  const missingStops = useMemo(() => {
    if (!vehicle) return [];
    const runs = runPick ? vehicle.runs.filter((r) => r.run.id === runPick) : vehicle.runs;
    const seen = new Map<string, string>();
    for (const r of runs) {
      for (const st of r.run.stops) {
        if (st.kind !== "stop" || !st.stopId || coordStopIds.has(st.stopId)) continue;
        if (!seen.has(st.stopId)) seen.set(st.stopId, st.stopName);
      }
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [vehicle, runPick, coordStopIds]);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const placing = missingStops.find((m) => m.id === placingId) ?? null;
  function placeAt(lat: number, lng: number) {
    if (!placing) return;
    moveStop(placing.id, lat, lng);
    setPlacingId(null);
  }
  const focusName = focusStopId ? (stops.find((x) => x.id === focusStopId.split("#")[0])?.name ?? null) : null;

  const mapStops = useMemo<MapStop[]>(() => {
    // 🔑 **[전체]에선 정류장 마커를 찍지 않는다**(사용자 2026-10-14 "호차를 눌렀을 때 보이게, 전체에 말고") — 학원만.
    if (!vehicle) return [];
    const byId = new Map(stops.map((s) => [s.id, s]));
    // 회차를 **직접 고른** 경우만 그 회차 정류장(순서 번호). 호차만 누른 상태(아래 상세는 자동으로 한 회차를 펼친다)에선
    // 그 차 노선 **전체** 정류장을 찍는다 — 호차를 누르자마자 그 차가 도는 곳이 다 보이게.
    const run = runPick ? vehicle.runs.find((r) => r.run.id === runPick) ?? null : null;
    if (run) {
      const ordered = [...run.run.stops].sort((a, b) => a.sortOrder - b.sortOrder);
      return ordered.flatMap((rs, i) => {
        const s = rs.stopId ? byId.get(rs.stopId) : undefined;
        return s && hasCoords(s) ? [{ stopId: `${s.id}#${i}`, name: `${i + 1}. ${s.name}`, lat: s.lat ?? null, lng: s.lng ?? null }] : [];
      });
    }
    const used = new Set<string>();
    for (const r of vehicle.runs) for (const s of r.run.stops) if (s.stopId) used.add(s.stopId);
    return stops
      .filter((s) => used.has(s.id) && hasCoords(s))
      .map((s) => ({ stopId: s.id, name: s.name, lat: s.lat ?? null, lng: s.lng ?? null }));
  }, [stops, vehicle, runPick]);

  // 🚌 운행 중 차 위치(0383a) — 10초마다 다시 읽는다. [전체] = 모든 차 · 호차 = 그 차 · 회차 = 그 회차.
  const { positions, now } = useVehiclePositions(getStaffVehiclePositions);
  const mapVehicles: MapVehicle[] = positions.flatMap((p) => {
    const owner = board.find((v) => v.runs.some((r) => r.run.id === p.runId));
    if (!owner) return [];
    if (vehicle && owner.vehicleId !== vehicle.vehicleId) return [];
    if (vehicle && runPick && p.runId !== runPick) return [];
    const age = ageSeconds(p.receivedAt, now);
    return [{ key: p.runId, label: owner.vehicleName, lat: p.lat, lng: p.lng, age: ageLabel(age), stale: age > STALE_AFTER_S }];
  });

  /**
   * 🟢 운행 중 회차의 **지금 위치 → 다음 정류장**(사용자 2026-10-21) — 위치 신호가 살아 있고(끊김 아님) 도로 경로가 있을 때만.
   * 전체 노선 줄(파랑·주황) **위에** 이 선을 녹색으로 겹친다(처음엔 노선을 숨겼다가 사용자가 되돌렸다, 2026-10-21). 판정은 순수 live-leg.ts(추가 API 호출 없음).
   */
  const liveByRun = useMemo(() => {
    const out = new Map<string, LiveLeg>();
    for (const { run, result } of routeRows) {
      if (!run || run.state !== "running" || !result?.ok || !result.legEnds) continue;
      const p = positions.find((x) => x.runId === run.run.id);
      if (!p || ageSeconds(p.receivedAt, now) > STALE_AFTER_S) continue;
      const live = liveLegPath(result.legs, result.legEnds, { lat: p.lat, lng: p.lng });
      if (live) out.set(run.run.id, live);
    }
    return out;
  }, [routeRows, positions, now]);

  const href = (d: string, s: Season = season) => `${SHUTTLE_TRACK_PATH}?d=${d}&season=${s}`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* 면 전환 + 날짜·시즌 한 줄 — 다른 셔틀 면과 같은 부품(ShuttleDayNav, 디자인 v5 17단계). */}
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabs faces={shuttleFaces(season, { track: true })} active={SHUTTLE_TRACK_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ShuttleDayNav date={date} today={today} season={season} hrefFor={href} />
        {tripsReady && summary.running > 0 && (
          <Pill color={TONE_COLOR.info}>운행 중 {summary.running}</Pill>
        )}
        {/* 시각을 적는다 — "방금"은 10분 뒤에 거짓이 된다(신호가 온 적 없으면 아예 안 그린다). */}
        {lastSignalAt !== null && (
          <span className="text-green ml-auto text-xs font-bold whitespace-nowrap">
            <span className="num">{kstTimeOf(new Date(lastSignalAt))}</span> 갱신됨
          </span>
        )}
      </div>

      {/* 🔑 **왜 아직 비어 있는지를 한 번만** 말한다 — 카드마다 반복하면 잔소리가 된다. */}
      {/* 호차 고르기 — [전체] + 그날 도는 차들. */}
      {board.length > 0 && (
        <div role="tablist" aria-label="호차 선택" className="flex flex-wrap gap-1.5">
          {[{ id: "all", name: "전체" }, ...board.map((v) => ({ id: v.vehicleId, name: v.vehicleName }))].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={vehicleId === t.id}
              onClick={() => pickVehicle(t.id)}
              // 크기는 셔틀 칩 캐논(폰 44px · control-size.ts) — 달리는 차 안에서도 누른다.
              className={`${SHUTTLE_CHIP} px-4 font-bold ${vehicleId === t.id ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* 🚏 버스 노선도 — [전체]면 차마다 모든 회차, 호차를 고르면 그 차 회차들(누르면 그 회차를 고른다),
          회차를 고르면 **그 회차만**(사용자 2026-10-14 "그 회차에 관한 노선만 위에 띄워줘"). */}
      {board.length > 0 && (
        <div className="flex flex-col gap-2">
          {(vehicle ? [vehicle] : board).map((v) => (
            <section key={v.vehicleId} className="flex flex-col gap-1.5">
              {!vehicle && <h3 className="text-text-dim px-1 text-xs font-bold">{v.vehicleName}</h3>}
              {(vehicle && runPick ? v.runs.filter((r) => r.run.id === runPick) : v.runs).map((r) => (
                <RunLineDiagram
                  key={r.run.id}
                  run={r.run}
                  active={!!vehicle && r.run.id === runPick}
                  onPick={vehicle ? () => setRunPick(r.run.id) : undefined}
                  coords={coordById}
                  position={positions.find((p) => p.runId === r.run.id) ?? null}
                  now={now}
                />
              ))}
              {/* 회차 하나만 보는 중이면 다시 그 차 회차 전부로 돌아가는 문. */}
              {vehicle && runPick ? (
                <button type="button" onClick={() => setRunPick(null)} className="text-primary self-start px-1 text-xs font-bold underline">
                  {v.vehicleName} 회차 전부 보기
                </button>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {/* 🔑 지도 하나에 학원 + 그날 도는 노선의 정류장 + 운행 중 차(🚌 기사 폰 GPS, 0383a). */}
      {/* 지도 위 한 줄 — 위치 수정 모드 · 고른 정류장 구간 되돌리기(사용자 2026-10-21). */}
      {KAKAO_MAP_KEY ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* 편성 쓰기 권한이 없으면 수정 모드 입구 자체가 없다 — 그러면 핀 끌기·위치 찍기도 열리지 않는다. */}
          {canEditStops ? (
            <button
              type="button"
              onClick={() => {
                setEditStops((v) => !v);
                setEditMsg(null);
                setFocusStopId(null);
                setPlacingId(null);
              }}
              aria-pressed={editStops}
              className={`${SHUTTLE_CHIP} ${editStops ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF}`}
            >
              {editStops ? "위치 수정 끝내기" : "위치 수정"}
            </button>
          ) : null}
          {editStops ? (
            <span className="text-text-dim break-keep">
              {vehicle
                ? "정류장 핀을 끌어 놓으면 바로 저장됩니다 — 이름은 그대로, 위치만 바뀝니다."
                : "위에서 호차를 고르면 그 노선의 정류장 핀이 뜹니다."}
              {saving ? " 저장 중…" : ""}
            </span>
          ) : focusName ? (
            <>
              <span className="text-foreground font-bold break-keep">{focusName} → 다음 정류장 구간만 보는 중</span>
              <button type="button" onClick={() => setFocusStopId(null)} className={`${SHUTTLE_CHIP} ${SHUTTLE_CHIP_OFF}`}>
                전체 코스 보기
              </button>
            </>
          ) : vehicle ? (
            <span className="text-text-faint break-keep">정류장을 누르면 그 정류장에서 다음 정류장까지만 보입니다.</span>
          ) : null}
          {editMsg ? <span className="text-primary font-bold">{editMsg}</span> : null}
        </div>
      ) : null}
      {/* 📍 위치 없는 정류장 — 수정 모드 + 호차를 골랐을 때만. 고르고 지도를 누르면 그 자리로 저장. */}
      {KAKAO_MAP_KEY && editStops && vehicle && missingStops.length > 0 ? (
        <div className="border-amber/40 bg-amber-soft flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs">
          <span className="text-foreground font-bold">위치 없는 정류장</span>
          {missingStops.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={placingId === m.id}
              onClick={() => setPlacingId((id) => (id === m.id ? null : m.id))}
              className={`${SHUTTLE_CHIP} ${placingId === m.id ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF} bg-card`}
            >
              {m.name}
            </button>
          ))}
          <span className="text-text-dim break-keep">
            {placing ? `지도에서 ${placing.name} 자리를 누르세요 — 누른 곳으로 바로 저장됩니다.` : "정류장을 고른 뒤 지도에서 자리를 누르면 위치가 찍힙니다."}
          </span>
        </div>
      ) : null}
      {KAKAO_MAP_KEY ? (
        <ParentLiveMap
          appKey={KAKAO_MAP_KEY}
          academy={ACADEMY_LOCATION}
          stops={mapStops}
          paths={routeRows.flatMap((x) => {
            if (!x.result?.ok) return [];
            if (focusName) {
              const starts = x.result.legStarts ?? [];
              return x.result.legs.flatMap((l, i) => (starts[i] === focusName ? [{ path: l.path, kind: l.kind }] : []));
            }
            // 운행 중이어도 전체 노선은 그대로 둔다(사용자 2026-10-21 "다시 운행 노선 다 띄우고") — 녹색 다음 정류장 선은 그 위에 겹친다.
            return x.result.legs.map((l) => ({ path: l.path, kind: l.kind }));
          })}
          livePaths={[...liveByRun.values()].map((l) => l.path)}
          vehicles={mapVehicles}
          editStops={editStops}
          onStopMove={moveStop}
          onMapClick={placeAt}
          onStopClick={vehicle ? setFocusStopId : undefined}
        />
      ) : null}
      {/* 이동 경로 요약 — 회차마다 한 줄. 거리·시간은 카카오 길찾기(추천 경로) 기준 추정치다. */}
      {vehicle ? (
        <div className="text-text-dim -mt-1 flex flex-col gap-0.5 text-xs break-keep">
          {routeRows.length === 0 ? (
            <p>이 차 노선엔 위치가 찍힌 정류장이 없어 이동 경로를 그릴 수 없습니다 — [노선 편성 → 정류장 관리]에서 위치를 찍으세요.</p>
          ) : (
            routeRows.map(({ run, result }) => (
              <p key={run?.run.id ?? "?"}>
                🛣️ <b className="text-foreground">{run ? `${firstTime(run.run) || "—"} ${runShortTitle(run.run)}` : "회차"}</b>{" "}
                {!result ? (
                  "이동 경로를 불러오는 중…"
                ) : result.ok && run && liveByRun.has(run.run.id) ? (
                  <>
                    <span className="text-green font-bold">운행 중 · 다음 정류장 {liveByRun.get(run.run.id)!.nextStop}</span> · 약{" "}
                    <span className="text-foreground num font-bold">{Math.max(1, Math.round(liveByRun.get(run.run.id)!.remainingS / 60))}분</span>{" "}
                    (<span className="num">{(liveByRun.get(run.run.id)!.remainingM / 1000).toFixed(1)}km</span>)
                  </>
                ) : result.ok ? (
                  <>
                    <span className="text-foreground num font-bold">{(result.distanceM / 1000).toFixed(1)}km</span> · 약{" "}
                    <span className="text-foreground num font-bold">{Math.round(result.durationS / 60)}분</span> (정차 시간 제외)
                    {result.skipped.length > 0 ? ` · 위치 없어 빠진 곳: ${result.skipped.join(", ")}` : ""}
                  </>
                ) : (
                  result.error
                )}
              </p>
            ))
          )}
        </div>
      ) : null}

      {/* 🔑 **왜 차가 아직 안 보이는지를 한 번만** 말한다 — 카드마다 반복하면 잔소리가 된다. */}
      <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed px-3 py-2.5 text-xs leading-relaxed">
        지도에는 <span className="text-foreground font-bold">학원과 오늘 도는 노선의 정류장</span>이 표시됩니다. 차량 위치는
        아직 없습니다 —{" "}
        <span className="text-foreground font-bold">운행 중 기사·동승 선생님 폰이 위치를 보내는 기능</span>이 붙으면 이 지도에
        차가 뜹니다{KAKAO_MAP_KEY ? "" : " (지도 키 NEXT_PUBLIC_KAKAO_MAP_KEY도 필요)"}. 지금은{" "}
        <Link href={`/shuttle/live?d=${date}&season=${season}`} className="text-primary font-bold underline">
          운행 현황
        </Link>{" "}
        탭에서 어느 회차가 도는지·누가 탔는지를 볼 수 있습니다.
      </div>

      {/* 🔴 0243a 미적용 — 상태를 그리는 대신 **왜 안 보이는지**를 말한다(운행 현황과 같은 규약). */}
      {!tripsReady && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed px-3 py-2 text-xs">
          운행 상태(출발·종료)는 마이그레이션 <span className="num">0243a</span>를 적용하면 보입니다.
        </div>
      )}

      {board.length === 0 && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          이 날짜에 타기로 되어 있는 학생이 없습니다.
        </div>
      )}

      {vehicle ? (
        <TrackRunDetail vehicle={vehicle} runId={runId} onPickRun={setRunPick} tripsReady={tripsReady} />
      ) : null}

      <div className={vehicle ? "hidden" : "grid grid-cols-1 gap-3 xl:grid-cols-2"}>
        {board.map((vehicle) => (
          <TrackVehicleCard
            key={vehicle.vehicleId}
            vehicle={vehicle}
            tripsReady={tripsReady}
            coordByStop={coordByStop}
          />
        ))}
      </div>
    </div>
  );
}
