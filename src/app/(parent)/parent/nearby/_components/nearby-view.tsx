"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { cn } from "@/lib/utils";
import type { AcademyLocation } from "@/features/shuttle/map/academy-location";
import type { MapStop } from "@/features/shuttle/map/components/parent-live-map";
import { candidateStops, rankByWalk, CANDIDATE_MAX_M, RANK_LIMIT, type NetRun, type NetStop, type RankedStop } from "@/features/shuttle/parent/nearby";
import { searchNearbyPlace, walkRoutesFrom, type PlaceHit } from "@/features/shuttle/parent/server/nearby-actions";
import type { WalkRoute } from "@/features/shuttle/parent/server/walk-route";
import { DIRECTION_LABEL, type Direction } from "@/features/shuttle/types";

// 지도는 보일 때만 받는다(B5) — 카카오 SDK·지도 코드가 첫 화면을 막지 않게.
const ParentLiveMap = dynamic(() => import("@/features/shuttle/map/components/parent-live-map").then((m) => m.ParentLiveMap), {
  ssr: false,
  loading: () => <div className="bg-muted h-72 animate-pulse rounded-2xl" />,
});

const IO_TONE = { in: TONE_COLOR.info, out: TONE_COLOR.special } as const satisfies Record<Direction, unknown>;
const distLabel = (m: number) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);

export type NearbyPoint = { lat: number; lng: number; label: string };
type Point = NearbyPoint;
type Walks = { at: string } & ({ state: "loading" } | { state: "done"; routes: Record<string, WalkRoute> } | { state: "error"; msg: string });

/**
 * 가까운 노선 찾기(사용자 2026-10-26 다시 설계) — **장소만** 받아서 → **걸어서 가까운 정류장 5등까지** + 그곳을 지나는 노선 전부.
 * 🔑 거리·시간·순위는 전부 **도보 길 기준**(T맵 보행자, 실패 시 카카오 도로 — 카드마다 어느 기준인지 밝힌다). 직선은 후보 고르기에만.
 * 🔑 검색어·위치는 **저장하지 않는다**(집 위치일 수 있다 — 이 화면 상태로만 쓰고 버린다).
 */
export function NearbyView({
  appKey,
  academy,
  stops,
  runs,
  showMyLocation = true,
  initialPoint = null,
  belowSearch,
  routeLines,
  routeStops,
  wide = false,
}: {
  appKey: string;
  academy: AcademyLocation;
  stops: NetStop[];
  runs: NetRun[];
  /** '지금 내 위치로 찾기' — 학부모만(관리자 화면은 끈다, 2026-10-26). */
  showMyLocation?: boolean;
  /** 처음부터 찍을 자리 — 관리자 화면이 학생·학교를 누르면 이 값으로 **다시 마운트**한다(key). */
  initialPoint?: NearbyPoint | null;
  /** 검색창 아래에 끼울 것 — 관리자 화면의 호차·회차 버튼(2026-10-26). */
  belowSearch?: ReactNode;
  /** 지도에 함께 그릴 셔틀 노선(관리자가 고른 호차·회차) — 있으면 걷는 길은 녹색 겹선으로 그린다. */
  routeLines?: { path: [number, number][]; kind: "out" | "back" }[];
  /** 그 노선의 정류장 표시. */
  routeStops?: MapStop[];
  /**
   * 넓은 화면 배치(관리자, 사용자 2026-10-26) — 검색창은 지금 너비 그대로(넓혀도 안 늘어난다), 지도와 추천 목록은 **나란히**
   * (지도 3 : 추천 2) 놓아 함께 본다. 좁은 화면에선 위아래로 쌓인다. 학부모 화면은 기본(위아래).
   */
  wide?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [point, setPoint] = useState<Point | null>(initialPoint);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [locating, setLocating] = useState(false);

  const pointKey = point ? `${point.lat},${point.lng}` : "";
  const candidates = useMemo(() => (point ? candidateStops(point, stops, runs) : []), [point, stops, runs]);

  /** 후보마다 걸어가는 길 — 위치가 바뀌면 다시 잰다. 어느 위치 기준인지(`at`)를 들고 있어 옛 결과는 저절로 버려진다. */
  const [walks, setWalks] = useState<Walks | null>(null);
  useEffect(() => {
    if (!point || !candidates.length) return;
    const at = `${point.lat},${point.lng}`;
    let alive = true;
    void walkRoutesFrom(
      { lat: point.lat, lng: point.lng },
      candidates.map((c) => ({ id: c.stop.id, lat: c.stop.lat, lng: c.stop.lng })),
    ).then((res) => {
      if (alive) setWalks("error" in res ? { at, state: "error", msg: res.error } : { at, state: "done", routes: res.routes });
    });
    return () => {
      alive = false;
    };
  }, [point, candidates]);
  /** 지금 위치의 결과가 아직 없으면 '재는 중'. */
  const walksNow: Walks = useMemo(() => (walks && walks.at === pointKey ? walks : { at: pointKey, state: "loading" }), [walks, pointKey]);

  const ranked: RankedStop[] = useMemo(() => {
    if (walksNow.state !== "done") return [];
    const m = new Map(Object.entries(walksNow.routes).map(([id, r]) => [id, { distanceM: r.distanceM, walkMin: r.walkMin }]));
    return rankByWalk(candidates, m, RANK_LIMIT);
  }, [walksNow, candidates]);

  /** 지도에 길을 그릴 정류장 — 고르지 않았으면 1등. */
  const [picked, setPicked] = useState<{ at: string; stopId: string } | null>(null);
  const selectedId = picked && picked.at === pointKey && ranked.some((r) => r.stop.id === picked.stopId) ? picked.stopId : ranked[0]?.stop.id;
  const selectedRoute = walksNow.state === "done" && selectedId ? walksNow.routes[selectedId] : undefined;

  const mapStops: MapStop[] = useMemo(() => {
    if (!point) return [];
    const me: MapStop = { stopId: "me", name: point.label, lat: point.lat, lng: point.lng, role: "here" };
    return [me, ...ranked.map((r) => ({ stopId: r.stop.id, name: `${r.rank}. ${r.stop.name}`, lat: r.stop.lat, lng: r.stop.lng }))];
  }, [point, ranked]);
  /** 지도 정류장 = 검색한 곳 + 순위 정류장 + (관리자가 고른) 노선 정류장 — 같은 정류장은 한 번만. */
  const allStops: MapStop[] = useMemo(() => {
    const seen = new Set(mapStops.map((m) => m.stopId));
    return [...mapStops, ...(routeStops ?? []).filter((m) => !seen.has(m.stopId))];
  }, [mapStops, routeStops]);
  const hasRoutes = (routeLines?.length ?? 0) > 0;

  function choosePoint(p: Point) {
    setPoint(p);
    setPicked(null);
  }

  function search() {
    const query = q.trim();
    if (!query) return;
    setError(null);
    startBusy(async () => {
      const res = await searchNearbyPlace(query, { lat: academy.lat, lng: academy.lng });
      if ("error" in res) {
        setError(res.error);
        setHits(null);
        return;
      }
      // 🔑 검색하면 **첫 결과를 바로 찍는다**(사용자 2026-10-22) — 나머지는 아래 "다른 장소였나요?"에서 바꾼다.
      const [first, ...rest] = res.hits;
      if (first) choosePoint({ lat: first.lat, lng: first.lng, label: first.name });
      setHits(first ? rest : []);
    });
  }

  function useMyLocation() {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("이 기기에서는 위치를 확인할 수 없어요 — 장소를 검색해 주세요");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setHits(null);
        choosePoint({ lat: p.coords.latitude, lng: p.coords.longitude, label: "지금 내 위치" });
      },
      () => {
        setLocating(false);
        setError("위치 권한이 없어 확인하지 못했어요 — 장소를 검색해 주세요");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section className={cn("bg-card flex flex-col gap-2 rounded-2xl p-3 shadow-[var(--shadow-card)]", wide && "w-full max-w-xl")}>
        <p className="text-text-dim text-sm break-keep">장소를 검색하면 걸어서 가까운 셔틀 정류장과 그곳을 지나는 노선을 보여 드려요.</p>
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">장소 검색</span>
            <EyIcon name="search" size={16} className="text-text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              placeholder="예: 침산푸르지오, 칠성초"
              className="border-line focus:border-primary h-11 w-full rounded-xl border pr-3 pl-9 text-base outline-none"
            />
          </label>
          <button
            type="button"
            onClick={search}
            disabled={busy || !q.trim()}
            className="bg-primary text-primary-foreground h-11 shrink-0 cursor-pointer rounded-xl px-4 text-sm font-bold disabled:opacity-50"
          >
            {busy ? "찾는 중…" : "검색"}
          </button>
        </div>
        {belowSearch}
        {showMyLocation ? (
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="border-line text-foreground hover:bg-muted flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-sm font-bold disabled:opacity-50"
        >
          <EyIcon name="mapPin" size={16} />
          {locating ? "위치 확인 중…" : "지금 내 위치로 찾기"}
        </button>
        ) : null}
        {error ? <p className="text-danger text-sm font-bold break-keep">{error}</p> : null}
        {hits && hits.length === 0 && !point ? <p className="text-text-dim text-sm">검색 결과가 없어요 — 다른 이름으로 찾아 주세요.</p> : null}
        {hits && hits.length > 0 ? (
          <ul className="flex flex-col gap-1">
            <li className="text-text-dim px-2 pt-1 text-xs">다른 장소였나요?</li>
            {hits.map((h, i) => (
              <li key={`${h.name}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    choosePoint({ lat: h.lat, lng: h.lng, label: h.name });
                    setHits(null);
                  }}
                  className="hover:bg-muted flex min-h-11 w-full cursor-pointer flex-col items-start rounded-lg px-2 py-1.5 text-left"
                >
                  <span className="text-sm font-bold">{h.name}</span>
                  {h.address ? <span className="text-text-dim text-xs">{h.address}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className={cn("flex flex-col gap-3", wide && "lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start")}>
      {appKey && (point || hasRoutes) ? (
        <ParentLiveMap
          appKey={appKey}
          academy={academy}
          stops={allStops}
          paths={hasRoutes ? routeLines : selectedRoute ? [{ path: selectedRoute.path, kind: "out" }] : undefined}
          livePaths={hasRoutes && selectedRoute ? [selectedRoute.path] : undefined}
        />
      ) : null}
      {point ? (
        <div className={cn("flex flex-col gap-3", wide && "lg:max-h-[55dvh] lg:overflow-y-auto lg:px-1 lg:pb-1")}>
          <p className="text-sm break-keep">
            <span className="font-bold">{point.label}</span>에서 걸어서 가까운 정류장 {RANK_LIMIT}곳
          </p>
          {candidates.length === 0 ? (
            <Empty>가까운 곳(직선 {distLabel(CANDIDATE_MAX_M)} 안)에 셔틀 정류장이 없어요 — 학원에 문의해 주세요.</Empty>
          ) : walksNow.state === "loading" ? (
            <Empty>걸어가는 길을 재는 중…</Empty>
          ) : walksNow.state === "error" ? (
            <p className="text-danger text-sm font-bold break-keep">{walksNow.msg}</p>
          ) : ranked.length === 0 ? (
            <Empty>걸어갈 수 있는 정류장을 찾지 못했어요 — 다른 장소로 찾아 주세요.</Empty>
          ) : (
            <ol className="flex flex-col gap-2">
              {ranked.map((r) => (
                <li key={r.stop.id}>
                  <button
                    type="button"
                    onClick={() => setPicked({ at: pointKey, stopId: r.stop.id })}
                    aria-pressed={selectedId === r.stop.id}
                    className={cn(
                      "bg-card flex w-full cursor-pointer flex-col items-start gap-1.5 rounded-2xl p-3 text-left shadow-[var(--shadow-card)]",
                      selectedId === r.stop.id && "ring-primary ring-2",
                    )}
                  >
                    <StopCard stop={r} source={walksNow.routes[r.stop.id]?.source} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-4 text-center text-sm break-keep">{children}</div>;
}

/** 순위 카드 — 순위 · 정류장 · 걸어서 몇 분(어느 기준) · 그곳을 지나는 노선 전부. */
function StopCard({ stop: r, source }: { stop: RankedStop; source: WalkRoute["source"] | undefined }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="num bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full text-xs font-bold">{r.rank}</span>
        <span className="font-bold break-keep">{r.stop.name}</span>
      </span>
      <span className="text-sm break-keep">
        걸어서 약 <span className="num font-bold">{r.walk.walkMin}분</span> · <span className="num">{distLabel(r.walk.distanceM)}</span>{" "}
        <span className="text-text-dim text-xs">{source === "tmap" ? "(보행자 길 기준)" : "(차도 기준 어림)"}</span>
      </span>
      <ul className="flex w-full flex-col gap-1">
        {r.runs.map(({ run, time }) => (
          <li key={run.id} className="flex flex-wrap items-center gap-1.5 text-sm">
            <Pill color={IO_TONE[run.direction]}>{DIRECTION_LABEL[run.direction]}</Pill>
            <span className="font-bold">
              {run.vehicleName} {run.runName}
            </span>
            <span className="num text-text-dim">{time ?? "시각 미정"}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
