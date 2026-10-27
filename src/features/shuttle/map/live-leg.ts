/**
 * 운행 중 **지금 위치 → 다음 정류장** 경로(순수 · Vitest) — 사용자 2026-10-21 *"운행중 사인이 들어오면 파란색·주황색 노선줄은
 * 없애고 지금위치에서 다음 지정된 위치까지 노선만"*.
 *
 * 🔑 재료는 회차를 열 때 한 번 받아 둔 카카오 길찾기 구간(`RunRoadPath.legs` — 구간 i = 점 i → 점 i+1)뿐이다.
 *    차 위치가 10초마다 바뀌어도 **추가 API 호출이 없다**.
 * 🔑 차 좌표를 모든 구간의 도로 선에 겹쳐 **가장 가까운 지점**을 찾는다 → 그 구간의 끝 = 다음 정류장.
 *    같은 거리면 **앞 구간**(같은 길을 오가는 노선에서 아직 안 지난 쪽으로 읽지 않게).
 * 🔑 남은 시간 = 그 구간의 카카오 예상 시간 × 남은 거리 비율(정차 시간 제외 추정).
 * ⚠️ 노선에서 너무 멀면(OFF_ROUTE_M) 판정하지 않는다 — 엉뚱한 "다음 정류장"을 말하지 않는다.
 */

export type LegLike = { path: [number, number][]; distanceM: number; durationS: number };

export type LiveLeg = {
  /** 몇 번째 구간인가(0부터). */
  legIndex: number;
  /** 그 구간의 끝 = 다음 정류장 이름. */
  nextStop: string;
  /** 차 위치 → 다음 정류장 도로 선([위도, 경도]) — 첫 점이 차 위치다. */
  path: [number, number][];
  remainingM: number;
  remainingS: number;
};

/** 이보다 멀면 노선 밖으로 본다(GPS 오차 + 정류장 들르기 여유). */
export const OFF_ROUTE_M = 300;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 기준 위도에서 평면 미터 좌표로(수 km 범위라 등장방형 근사로 충분하다). */
function xy([lat, lng]: [number, number], lat0: number): [number, number] {
  return [rad(lng) * R * Math.cos(rad(lat0)), rad(lat) * R];
}

function segLen(a: [number, number], b: [number, number], lat0: number): number {
  const [ax, ay] = xy(a, lat0);
  const [bx, by] = xy(b, lat0);
  return Math.hypot(bx - ax, by - ay);
}

export function liveLegPath(
  legs: readonly LegLike[],
  legEnds: readonly string[],
  bus: { lat: number; lng: number },
): LiveLeg | null {
  const lat0 = bus.lat;
  const [px, py] = xy([bus.lat, bus.lng], lat0);
  let best: { leg: number; seg: number; t: number; d: number; point: [number, number] } | null = null;

  legs.forEach((leg, li) => {
    for (let si = 0; si + 1 < leg.path.length; si++) {
      const a = leg.path[si]!;
      const b = leg.path[si + 1]!;
      const [ax, ay] = xy(a, lat0);
      const [bx, by] = xy(b, lat0);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      // 엄격히 작을 때만 바꾼다 — 같은 거리면 앞 구간이 이긴다.
      if (!best || d < best.d - 0.01) {
        best = { leg: li, seg: si, t, d, point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
      }
    }
  });

  const hit = best as { leg: number; seg: number; t: number; d: number; point: [number, number] } | null;
  if (!hit || hit.d > OFF_ROUTE_M) return null;
  const leg = legs[hit.leg]!;
  const rest = leg.path.slice(hit.seg + 1);
  const path: [number, number][] = [[bus.lat, bus.lng], hit.point, ...rest];

  let remainingM = segLen(hit.point, rest[0] ?? hit.point, lat0);
  for (let i = 0; i + 1 < rest.length; i++) remainingM += segLen(rest[i]!, rest[i + 1]!, lat0);
  let legLen = 0;
  for (let i = 0; i + 1 < leg.path.length; i++) legLen += segLen(leg.path[i]!, leg.path[i + 1]!, lat0);
  const ratio = legLen > 0 ? Math.min(1, remainingM / legLen) : 0;

  return {
    legIndex: hit.leg,
    nextStop: legEnds[hit.leg] ?? "",
    path,
    remainingM: Math.round(remainingM),
    remainingS: Math.round(leg.durationS * ratio),
  };
}
