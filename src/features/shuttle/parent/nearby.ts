/**
 * 학부모 **가까운 노선 찾기**(순수 · Vitest) — 사용자 2026-10-26 다시 설계: *"시간 말고 일단 장소만 검색을 받아서 도보로 움직이는
 * 기준 가까운 노선들을 전부 보여주는 걸로"* + *"가까운 노선 장소마다 순위를 매겨서 5등까지"*.
 *
 * 흐름: 직선 거리로 **후보 정류장**을 추린다(candidateStops) → 서버가 후보마다 **T맵 보행자 길**을 잰다 →
 *       걸어서 가까운 순으로 **순위 5등까지**(rankByWalk). 정류장마다 그곳을 지나는 회차를 모두 보여 준다.
 * 🔑 직선은 **후보를 고르는 데만** 쓴다(화면의 거리·시간·순위는 전부 도보 기준). 도보 길을 못 잰 정류장은 순위에서 뺀다.
 * 🔑 좌표 없는 정류장·회차가 하나도 안 지나는 정류장은 후보가 아니다.
 * ⚠️ 다른 아이 정보는 다루지 않는다 — 정류장 이름·좌표와 회차 시각만.
 */
import type { Direction } from "../types";

export type NetStop = { id: string; name: string; lat: number; lng: number };

export type NetRun = {
  id: string;
  vehicleName: string;
  /** "3회차" 또는 별칭. */
  runName: string;
  direction: Direction;
  /** 학원 기준 시각 — 등원이면 학원 도착, 하원이면 학원 출발("HH:MM"). 모르면 null. */
  academyTime: string | null;
  /** 노선 순서대로 정류장 칸(시각은 그 정류장 시각). */
  stops: { stopId: string; time: string | null }[];
};

/** 그 정류장을 지나는 회차 한 줄(정류장 시각과 함께). */
export type StopRun = { run: NetRun; time: string | null };
export type Candidate = { stop: NetStop; straightM: number; runs: StopRun[] };
/** 도보로 잰 결과 — 순위 화면이 쓴다. */
export type Walked = { distanceM: number; walkMin: number };
export type RankedStop = Candidate & { rank: number; walk: Walked };

/** 후보를 고르는 직선 반경 — 걸어서 25분 남짓(도보 길은 직선보다 길다). */
export const CANDIDATE_MAX_M = 1500;
/** 도보로 잴 후보 수(직선 가까운 순) — T맵 호출 수 = 이 값(하루 무료 1,000건). */
export const CANDIDATE_MAX = 8;
/** 화면에 보이는 순위(사용자 "5등까지"). */
export const RANK_LIMIT = 5;

const rad = (d: number) => (d * Math.PI) / 180;
/** 두 좌표 직선 거리(m, 하버사인). */
export function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const byTime = (a: string | null, b: string | null) => (a && b ? (a < b ? -1 : a > b ? 1 : 0) : a ? -1 : b ? 1 : 0);

/** 직선으로 후보 정류장 추리기 — 회차가 지나는 곳만, 가까운 순 최대 CANDIDATE_MAX개. 회차는 등원 먼저 · 정류장 시각 순. */
export function candidateStops(
  point: { lat: number; lng: number },
  stops: readonly NetStop[],
  runs: readonly NetRun[],
  opts: { maxM?: number; max?: number } = {},
): Candidate[] {
  const maxM = opts.maxM ?? CANDIDATE_MAX_M;
  const max = opts.max ?? CANDIDATE_MAX;
  const runsAt = new Map<string, StopRun[]>();
  for (const run of runs) {
    for (const s of run.stops) {
      const list = runsAt.get(s.stopId) ?? [];
      if (!list.some((x) => x.run.id === run.id)) list.push({ run, time: s.time });
      runsAt.set(s.stopId, list);
    }
  }
  return stops
    .map((stop) => ({ stop, straightM: Math.round(meters(point, stop)), runs: runsAt.get(stop.id) ?? [] }))
    .filter((c) => c.straightM <= maxM && c.runs.length > 0)
    .sort((a, b) => a.straightM - b.straightM)
    .slice(0, max)
    .map((c) => ({
      ...c,
      runs: [...c.runs].sort((a, b) => (a.run.direction !== b.run.direction ? (a.run.direction === "in" ? -1 : 1) : byTime(a.time, b.time))),
    }));
}

/** 도보 거리로 순위 매기기 — 걸어서 가까운 순(같으면 덜 걷는 시간), 길을 못 잰 정류장은 뺀다. */
export function rankByWalk(candidates: readonly Candidate[], walks: ReadonlyMap<string, Walked>, limit = RANK_LIMIT): RankedStop[] {
  return candidates
    .flatMap((c) => {
      const walk = walks.get(c.stop.id);
      return walk ? [{ ...c, walk }] : [];
    })
    .sort((a, b) => a.walk.distanceM - b.walk.distanceM || a.walk.walkMin - b.walk.walkMin)
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
