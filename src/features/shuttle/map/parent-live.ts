import type { RouteStop } from "../parent/parent-rides";
import type { TripState } from "../today/trip-state";
import type { Direction } from "../types";

/** 학부모 '실시간 차량' 노선 한 칸 — 노선 칸(`RouteStop`) + 좌표 + 우리 아이 탈 곳/내릴 곳. */
export type ParentLiveRouteStop = {
  id: string;
  kind: RouteStop["kind"];
  name: string;
  time: string | null;
  lat: number | null;
  lng: number | null;
  role?: "board" | "alight";
};

/** 오늘 우리 아이 셔틀 한 구간(아이 × 등원/하원) — 누르면 그 회차를 지도·노선도에 띄운다. */
export type ParentLiveLeg = {
  key: string;
  runId: string;
  direction: Direction;
  kidName: string;
  vehicleName: string;
  runName: string;
  /** 우리 아이 정류장 이름과 예정 시각. */
  stopName: string;
  time: string | null;
  trip: TripState | null;
  route: ParentLiveRouteStop[];
};

/**
 * 탈 곳 / 내릴 곳(사용자 2026-10-15 "내가 탈 곳 내릴 곳만 구분") —
 * **등원**: 우리 아이 정류장에서 타고 학원 도착에서 내린다. **하원**: 학원 출발에서 타고 우리 아이 정류장에서 내린다.
 * 🔑 학원 칸이 노선에 없으면 그쪽은 표시하지 않는다(지어내지 않는다). 우리 아이 칸(`mine`)이 없으면(예정 없는 추가 탑승) 아무 칸도 없다.
 */
export function routeRoles(route: readonly Pick<RouteStop, "id" | "kind" | "mine">[], direction: Direction): Map<string, "board" | "alight"> {
  const roles = new Map<string, "board" | "alight">();
  const mine = route.find((r) => r.mine);
  if (!mine) return roles;
  if (direction === "in") {
    roles.set(mine.id, "board");
    const arrive = route.find((r) => r.kind === "arrive");
    if (arrive) roles.set(arrive.id, "alight");
  } else {
    const depart = route.find((r) => r.kind === "depart");
    if (depart) roles.set(depart.id, "board");
    roles.set(mine.id, "alight");
  }
  return roles;
}

const toMinutes = (t: string | null) => (t && /^\d{2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/**
 * 처음 띄울 구간 — 운행 중인 구간 → 지금과 가장 가까운 시각(같으면 앞으로 올 것) → 첫 구간.
 * (직원 '실시간 위치'의 `nearestRunId`와 같은 규칙.)
 */
export function nearestLegKey(legs: readonly Pick<ParentLiveLeg, "key" | "time" | "trip">[], nowMinutes: number): string | null {
  const running = legs.find((l) => l.trip === "running");
  if (running) return running.key;
  let best: { key: string; gap: number; future: boolean } | null = null;
  for (const l of legs) {
    const m = toMinutes(l.time);
    if (m === null) continue;
    const gap = Math.abs(m - nowMinutes);
    const future = m >= nowMinutes;
    if (!best || gap < best.gap || (gap === best.gap && future && !best.future)) best = { key: l.key, gap, future };
  }
  return best?.key ?? legs[0]?.key ?? null;
}
