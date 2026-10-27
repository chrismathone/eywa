import "server-only";

/**
 * 걸어가는 길 찾기 — **T맵 보행자 길찾기 우선 → 실패하면 카카오 도로 길**(사용자 2026-10-26 "보행자 거리 측정을 하고 싶어 T맵을 넣어 볼까").
 *
 * 🔑 T맵 보행자는 인도·횡단보도·육교·지하도·단지 안 보행로까지 본다(카카오는 공개 도보 길찾기가 없어 차도 거리였다).
 * 🔑 키(`TMAP_APP_KEY`)가 없거나, 하루 한도(429)·오류면 **조용히 카카오로** 떨어지고 `source`로 어느 기준인지 알린다(화면이 밝힌다).
 * 🔑 같은 출발·도착은 **24시간 메모리 캐시**(T맵 약관의 데이터 보관 한도 24시간 안 — 호출 수를 줄인다). 좌표는 DB에 저장하지 않는다.
 */
export type WalkSource = "tmap" | "road";
export type WalkRoute = { path: [number, number][]; distanceM: number; walkMin: number; source: WalkSource };
type P = { lat: number; lng: number };

/** 카카오 도로 거리를 걷는 시간으로 바꿀 때의 보통 걸음(m/분, 약 4km/h). */
const WALK_M_PER_MIN = 67;
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { at: number; route: WalkRoute }>();
const keyOf = (a: P, b: P) => [a.lat, a.lng, b.lat, b.lng].map((v) => v.toFixed(5)).join(",");

export async function findWalkRoute(from: P, to: P): Promise<WalkRoute | null> {
  const k = keyOf(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.route;
  const route = (await tmapWalk(from, to)) ?? (await kakaoRoad(from, to));
  if (route) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(k, { at: Date.now(), route });
  }
  return route;
}

/** T맵 보행자 길찾기(SK오픈API). 실패·한도 초과·키 없음 = null(카카오로 넘긴다). */
async function tmapWalk(from: P, to: P): Promise<WalkRoute | null> {
  const appKey = process.env.TMAP_APP_KEY;
  if (!appKey) return null;
  try {
    const res = await fetch("https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json", {
      method: "POST",
      headers: { appKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        startX: String(from.lng),
        startY: String(from.lat),
        endX: String(to.lng),
        endY: String(to.lat),
        startName: encodeURIComponent("출발"),
        endName: encodeURIComponent("도착"),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        searchOption: "0", // 추천 경로
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[walk-route] tmap ${res.status} — 카카오 도로 길로 대신합니다`);
      return null;
    }
    const json = (await res.json()) as {
      features?: { geometry: { type: string; coordinates: number[] | number[][] }; properties?: { totalDistance?: number; totalTime?: number } }[];
    };
    const feats = json.features ?? [];
    const total = feats[0]?.properties;
    if (!total || total.totalDistance == null || total.totalTime == null) return null;
    const line: [number, number][] = [];
    for (const f of feats) {
      if (f.geometry.type !== "LineString") continue;
      for (const c of f.geometry.coordinates as number[][]) {
        const pt: [number, number] = [c[1]!, c[0]!];
        const last = line[line.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) line.push(pt);
      }
    }
    return {
      path: [[from.lat, from.lng], ...line, [to.lat, to.lng]],
      distanceM: Math.round(total.totalDistance),
      walkMin: Math.max(1, Math.ceil(total.totalTime / 60)),
      source: "tmap",
    };
  } catch (e) {
    console.warn("[walk-route] tmap 호출 실패 — 카카오 도로 길로 대신합니다", e);
    return null;
  }
}

/** 카카오모빌리티 자동차 길찾기(가장 짧은 거리) — 도보 API가 없어 차도 거리 ÷ 보통 걸음으로 어림한다. */
async function kakaoRoad(from: P, to: P): Promise<WalkRoute | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;
  const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${from.lng},${from.lat}`);
  url.searchParams.set("destination", `${to.lng},${to.lat}`);
  url.searchParams.set("priority", "DISTANCE");
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`kakao directions ${res.status}`);
  const json = (await res.json()) as {
    routes?: { result_code: number; summary?: { distance: number }; sections?: { roads: { vertexes: number[] }[] }[] }[];
  };
  const r = json.routes?.[0];
  // 104 = 출발지와 도착지가 너무 가깝다(5m 이내) — 사실상 그 자리다.
  if (r && r.result_code === 104) return { path: [[from.lat, from.lng], [to.lat, to.lng]], distanceM: 0, walkMin: 0, source: "road" };
  if (!r || r.result_code !== 0 || !r.summary) return null;
  const road: [number, number][] = [];
  for (const sec of r.sections ?? []) for (const rd of sec.roads) for (let k = 0; k + 1 < rd.vertexes.length; k += 2) road.push([rd.vertexes[k + 1]!, rd.vertexes[k]!]);
  const distanceM = r.summary.distance;
  return { path: [[from.lat, from.lng], ...road, [to.lat, to.lng]], distanceM, walkMin: Math.max(1, Math.round(distanceM / WALK_M_PER_MIN)), source: "road" };
}
