import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { ACADEMY_LOCATION } from "../academy-location";

export type RunRoadPath =
  | {
      ok: true;
      /** 도로를 따라가는 선 — [위도, 경도] 순서. */
      path: [number, number][];
      distanceM: number;
      durationS: number;
      /**
       * 정류장 사이 구간별(학원 → 첫 정류장 → … → 학원) + 그 구간의 도로 선.
       * `kind`: 'out' = 나가는 길(학원 출발부터 마지막 정류장까지) · 'back' = 돌아오는 길(마지막 정류장 → 학원 도착).
       */
      legs: { distanceM: number; durationS: number; path: [number, number][]; kind: "out" | "back" }[];
      /** 좌표가 없어 경로에서 빠진 정류장 이름. */
      skipped: string[];
    }
  | { ok: false; error: string };

/** 같은 정류장 좌표 조합이면 다시 묻지 않는다 — 실시간 위치 화면은 신호마다 다시 그려진다. */
const cache = new Map<string, { at: number; value: RunRoadPath }>();
const CACHE_MS = 10 * 60 * 1000;

/**
 * 회차의 **도로 경로**(사용자 2026-10-14 "마커들을 기준으로 차가 움직인다면 도로에서 통로를 보여줄래") —
 * 카카오모빌리티 다중 경유지 길찾기로 학원 → 정류장들(노선 순서) → 학원을 잇는다(학원 칸이 없는 쪽은 정류장에서 시작·끝).
 * 🔑 구간마다 선을 따로 돌려준다 — 화면이 **나가는 길 / 돌아오는 길**을 갈라 그린다(사용자 2026-10-14 "겹쳐서 구분이 안 된다").
 *
 * 🔑 REST 키(`KAKAO_REST_API_KEY`)는 서버 전용이라 여기서만 부른다 — 화면은 결과(선·거리·시간)만 받는다.
 * 🔒 **권한 확인은 부르는 쪽**(route-path.ts의 서버 액션 — 관리자용 / 학부모용)이 한다. 이 모듈은 server-only라 화면에서 직접 못 부른다.
 *    회차는 넘겨받은 학원 것만(admin 클라라 tenant 필터 필수, [[#104]]).
 * ⚠️ 좌표가 없는 정류장은 경로에서 빼고 이름만 돌려준다(지어내지 않는다). 순서는 **편성된 노선 순서 그대로** — 최적 순서를 따로 고르지 않는다.
 * ⚠️ 경유지는 카카오 제한(30개) 안. 길찾기가 실패하면 한글 사유만 돌려주고 지도는 마커만 그린다.
 */
export async function computeRunRoadPath(tenantId: string, runId: string): Promise<RunRoadPath> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { ok: false, error: "길찾기 키(KAKAO_REST_API_KEY)가 없습니다" };

  try {
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("shuttle_run_stops")
      .select("kind, sort_order, stop:shuttle_stops!shuttle_run_stops_stop_id_fkey(name, lat, lng)")
      .eq("tenant_id", tenantId)
      .eq("run_id", runId)
      .order("sort_order", { ascending: true })
      .limit(60);
    if (error) throw error;

    const skipped: string[] = [];
    const points: { name: string; x: number; y: number }[] = [];
    // 🔑 학원 출발·도착 칸이 있을 때만 학원을 끝점으로 쓴다 — 도착 칸 없는 하원 회차는 마지막 정류장에서 끝난다.
    const hasDepart = (rows ?? []).some((r) => r.kind === "depart");
    const hasArrive = (rows ?? []).some((r) => r.kind === "arrive");
    for (const r of rows ?? []) {
      if (r.kind !== "stop") continue;
      const s = r.stop as { name?: string; lat?: number | null; lng?: number | null } | null;
      if (s && typeof s.lat === "number" && typeof s.lng === "number") points.push({ name: s.name ?? "", x: s.lng, y: s.lat });
      else skipped.push(s?.name ?? "(이름 없음)");
    }
    if (points.length === 0) return { ok: false, error: "좌표가 있는 정류장이 없어 경로를 그릴 수 없습니다" };

    const academy = { name: ACADEMY_LOCATION.name, x: ACADEMY_LOCATION.lng, y: ACADEMY_LOCATION.lat };
    // 끝점 — 학원 칸이 없으면 첫/마지막 정류장이 그 자리를 맡는다(경유지에서 뺀다).
    const route = [...points];
    const origin = hasDepart ? academy : route.shift()!;
    const destination = hasArrive ? academy : (route.pop() ?? origin);
    const waypoints = route.slice(0, 30);
    if (!hasDepart && !hasArrive && waypoints.length === 0 && origin === destination) {
      return { ok: false, error: "정류장이 하나뿐이라 경로를 그릴 수 없습니다" };
    }
    const sig = JSON.stringify(["v2", origin, destination, waypoints]);
    const hit = cache.get(sig);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value.ok ? { ...hit.value, skipped } : hit.value;

    const res = await fetch("https://apis-navi.kakaomobility.com/v1/waypoints/directions", {
      method: "POST",
      headers: { Authorization: `KakaoAK ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination, waypoints, priority: "RECOMMEND" }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      routes?: {
        result_code: number;
        result_msg: string;
        summary: { distance: number; duration: number };
        sections: { distance: number; duration: number; roads: { vertexes: number[] }[] }[];
      }[];
    };
    const found = json.routes?.[0];
    if (!res.ok || !found || found.result_code !== 0) {
      return { ok: false, error: `길찾기 실패: ${found?.result_msg ?? `HTTP ${res.status}`}` };
    }

    const path: [number, number][] = [];
    const legs = found.sections.map((sec, i) => {
      const legPath: [number, number][] = [];
      for (const road of sec.roads) {
        const v = road.vertexes; // [x1, y1, x2, y2, …] = [경도, 위도, …]
        for (let k = 0; k + 1 < v.length; k += 2) legPath.push([v[k + 1]!, v[k]!]);
      }
      path.push(...legPath);
      // 마지막 구간이 학원 도착이면 '돌아오는 길', 나머지는 '나가는 길'.
      const kind: "out" | "back" = hasArrive && i === found.sections.length - 1 ? "back" : "out";
      return { distanceM: sec.distance, durationS: sec.duration, path: legPath, kind };
    });
    const value: RunRoadPath = {
      ok: true,
      path,
      distanceM: found.summary.distance,
      durationS: found.summary.duration,
      legs,
      skipped,
    };
    cache.set(sig, { at: Date.now(), value });
    return value;
  } catch (e) {
    reportError(e, { scope: "shuttle.routePath" });
    return { ok: false, error: "경로를 불러오지 못했습니다" };
  }
}
