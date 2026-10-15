/**
 * 차가 **노선 어디쯤**인가(사용자 2026-10-15 "노선도에 어디에 있는지 표시") — 노선 칸(정류장 순서) 위의 **소수 위치**.
 * 2.0 = 3번째 칸(정류장)에 있음, 2.4 = 3번째와 4번째 칸 사이 40%.
 *
 * 🔑 **기준은 기록**(사용자 2026-10-15 "시간 기준이 아니라 출발하고 난 뒤 탑승이나 하원 체크를 하면서. 아무것도 진행이
 *    안 됐으면 아직 출발에 위치") — 출발 뒤 탑승·미탑승·하차가 찍힌 **가장 뒤 칸**(`doneIndex`)이 바닥이다.
 *    기록이 없으면 0(학원 출발). 학원 출발·도착이 같은 자리여도 기록이 없으면 '도착'으로 가지 않는다.
 * 🔑 GPS는 **바닥에서 다음 칸까지만** 앞으로 민다 — "어느 두 정류장 사이를 지나는 중"을 보여 주되, 기록을 건너뛰어
 *    앞서 가거나 뒤로 가지 않는다. 정류장 사이는 직선으로 잇고 수선의 발을 내린다(도로 모양은 몰라도 사이 위치는 맞는다).
 * 🔑 좌표 없는 칸(예: 유진식당)은 건너뛰고 앞뒤 좌표 칸을 잇는다.
 * ⚠️ 고른 구간에서도 `OFF_ROUTE_M`보다 멀면 `offRoute` — 화면은 "노선에서 벗어남"으로 말한다(지어내지 않는다).
 * 순수 모듈(Vitest).
 */
import { ageLabel, ageSeconds, STALE_AFTER_S } from "./vehicle-position";

export type LatLngLike = { lat: number | null; lng: number | null };

export type RouteProgress = {
  /** 칸 번호 기준 소수 위치(0 = 첫 칸). */
  pos: number;
  /** 정류장 근처(`AT_STOP_M` 이내)면 그 칸 번호. */
  atStop: number | null;
  /** 노선(고른 구간)까지 거리(m). */
  distM: number;
  offRoute: boolean;
};

/** 이 거리 안이면 "그 정류장에 있음". */
export const AT_STOP_M = 60;
/** 이보다 멀면 노선에서 벗어난 것으로 본다. */
export const OFF_ROUTE_M = 800;

const toRad = (d: number) => (d * Math.PI) / 180;

/** 위경도 → 기준 위도 근처 평면(m). 수 km 범위라 충분하다. */
function xy(p: { lat: number; lng: number }, lat0: number): [number, number] {
  return [p.lng * 111_320 * Math.cos(toRad(lat0)), p.lat * 110_540];
}

/**
 * 출발 뒤 기록이 찍힌 **가장 뒤 칸** — 노선 칸(정렬된 순서, 정류장 마스터 id)과 기록의 정류장 id들로.
 * 같은 정류장이 노선에 두 번 나오면 앞쪽 칸으로 친다. 기록이 없거나 노선에 없는 정류장이면 0(학원 출발).
 */
export function doneIndexOf(route: readonly { stopId: string | null; kind: string }[], recordStopIds: readonly string[]): number {
  let done = 0;
  for (const id of recordStopIds) {
    const i = route.findIndex((r) => r.kind === "stop" && r.stopId === id);
    if (i > done) done = i;
  }
  return done;
}

/**
 * GPS 한 점 → 노선 위 위치. `floor`(기록 바닥)부터 다음 칸(`floor + 1`)까지만 본다 — 그 사이 어디쯤인지.
 * 좌표가 모자라 그 구간을 못 그리면 바닥 칸에 둔다.
 */
export function routeProgress(stops: readonly LatLngLike[], bus: { lat: number; lng: number }, floor = 0): RouteProgress | null {
  const n = stops.length;
  if (n === 0) return null;
  const lo = Math.max(0, Math.min(n - 1, Math.floor(floor)));
  const hi = Math.min(n - 1, lo + 1);
  const pts = stops.flatMap((s, i) => (typeof s.lat === "number" && typeof s.lng === "number" ? [{ i, lat: s.lat, lng: s.lng }] : []));
  if (pts.length === 0) return null;
  const lat0 = bus.lat;
  const [bx, by] = xy(bus, lat0);
  const dist = (p: { lat: number; lng: number }) => {
    const [x, y] = xy(p, lat0);
    return Math.hypot(bx - x, by - y);
  };

  // 바닥 쪽 좌표 점(바닥 칸에 좌표가 없으면 그 앞 마지막 좌표 칸)과 다음 쪽 좌표 점(다음 칸 이후 첫 좌표 칸).
  const a = [...pts].reverse().find((p) => p.i <= lo);
  const b = pts.find((p) => p.i >= hi && p.i > (a?.i ?? -1));
  if (!a || !b || lo === hi) {
    const only = (a ?? b)!;
    const d = dist(only);
    return { pos: lo, atStop: d <= AT_STOP_M ? lo : null, distM: d, offRoute: d > OFF_ROUTE_M };
  }

  const [ax, ay] = xy(a, lat0);
  const [cx, cy] = xy(b, lat0);
  const dx = cx - ax;
  const dy = cy - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((bx - ax) * dx + (by - ay) * dy) / len2));
  const d = Math.hypot(bx - (ax + t * dx), by - (ay + t * dy));
  // a~b 구간 위치를 칸 번호로 → 바닥~다음 칸 범위로 자른다.
  let pos = Math.max(lo, Math.min(hi, a.i + t * (b.i - a.i)));

  let atStop: number | null = null;
  if (a.i === lo && dist(a) <= AT_STOP_M) atStop = lo;
  else if (b.i === hi && dist(b) <= AT_STOP_M) atStop = hi;
  if (atStop !== null) pos = atStop;
  return { pos, atStop, distM: d, offRoute: d > OFF_ROUTE_M };
}

/**
 * 노선도에서 🚌를 놓을 자리 — 칸 번호와 그 칸 안 가로 위치(%).
 * 칸 사이 선은 앞 칸의 오른쪽 반 + 뒤 칸의 왼쪽 반이라, 구간 앞쪽 절반은 앞 칸(50~100%)에, 뒤쪽 절반은 뒤 칸(0~50%)에 놓는다.
 */
export function busSlot(pos: number, count: number): { cell: number; leftPct: number } {
  const clamped = Math.max(0, Math.min(count - 1, pos));
  const base = Math.floor(clamped);
  const frac = clamped - base;
  if (frac < 0.5 || base + 1 >= count) return { cell: base, leftPct: 50 + frac * 100 };
  return { cell: base + 1, leftPct: (frac - 0.5) * 100 };
}

/** 노선도 머리 아래 한 줄 — "🚌 지금 학원 출발에 있어요 · 방금" / "🚌 A → B 사이 · 25초 전" / "노선에서 벗어나 있어요". */
export function describeProgress(p: RouteProgress, names: readonly string[], age: string, stale: boolean): string {
  const tail = stale ? ` · 위치 끊김(${age})` : ` · ${age}`;
  if (p.offRoute) return `🚌 노선에서 약 ${p.distM >= 1000 ? `${(p.distM / 1000).toFixed(1)}km` : `${Math.round(p.distM)}m`} 벗어나 있어요${tail}`;
  if (p.atStop !== null || Number.isInteger(p.pos)) return `🚌 지금 ${names[p.atStop ?? p.pos] ?? "정류장"}에 있어요${tail}`;
  const a = names[Math.floor(p.pos)] ?? "";
  const b = names[Math.min(names.length - 1, Math.ceil(p.pos))] ?? "";
  return `🚌 ${a} → ${b} 사이를 지나고 있어요${tail}`;
}

/** 노선도에 넘길 🚌 — 노선 칸(이름·좌표) + 그 회차 최신 위치(기록 바닥 `doneIndex` 포함). 좌표 칸이 없으면 null. */
export function diagramBus(
  route: readonly { name: string; lat: number | null; lng: number | null }[],
  position: { lat: number; lng: number; receivedAt: string; doneIndex: number },
  now: number,
): { pos: number; text: string; stale: boolean } | null {
  const p = routeProgress(route, position, position.doneIndex);
  if (!p) return null;
  const age = ageSeconds(position.receivedAt, now);
  const stale = age > STALE_AFTER_S;
  return { pos: p.pos, text: describeProgress(p, route.map((r) => r.name), ageLabel(age), stale), stale };
}
