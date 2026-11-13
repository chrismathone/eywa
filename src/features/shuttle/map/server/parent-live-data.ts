import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { ACADEMY_LOCATION } from "../academy-location";
import { routeRoles, type ParentLiveLeg } from "../parent-live";
import { parentPortalAvailable } from "../../parent/server/parent-availability";
import { loadParentRideLegsFor } from "../../parent/server/parent-ride-data";
import type { ParentViewer } from "../../parent/server/parent-viewer";

/** 지도에 찍을 정류장 하나(학부모·직원 지도 공용 모양). */
export type ParentLiveStop = {
  /** 정류장 마스터 id(없으면 노선 칸 id). */
  stopId: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

export type ParentLiveData = {
  /** 오늘 우리 아이 셔틀 구간(아이 × 등원/하원) — 예정 시각 순. */
  legs: ParentLiveLeg[];
};

/**
 * 학부모 '실시간 차량' 재료(사용자 2026-10-08 지도 · 2026-10-15 "오늘 타고 내리는 곳을 누르면 그 회차 정보를 맵에") —
 * **우리 아이가 오늘 타는 회차**마다 노선 전체(정류장 순서·시각·좌표)와 탈 곳 / 내릴 곳.
 *
 * 🔴 차량 위치는 아직 없다(기사 폰 GPS 전송 미구현) — 여기서도 지어내지 않는다.
 * 🔴 아이 목록은 `getParentViewer()`가 준 것만. 노선은 그 아이들이 오늘 타는 회차의 **정류장 이름·시각·좌표뿐** —
 *    다른 아이 배정·이름은 싣지 않는다(`loadRideLegsFor`와 같은 선).
 * 🔑 학원 출발·도착 칸 좌표 = 학원 위치(`academy-location.ts`).
 * ⚠️ 좌표 칸(0244a)이 없거나 조회가 실패하면 좌표 없이 이름만 돌려준다(지도는 학원 중심으로 뜬다).
 */
export async function loadParentLiveData(viewer: ParentViewer): Promise<ParentLiveData> {
  const empty: ParentLiveData = { legs: [] };
  if (viewer.children.length === 0 || !(await parentPortalAvailable(viewer))) return empty;
  try {
    const { legs } = await loadParentRideLegsFor(viewer, viewer.children.map((c) => c.id), kstToday(), "term", true);
    const mineLegs = viewer.children.flatMap((child) =>
      (legs.get(child.id) ?? []).filter((l) => !l.skipped).map((leg) => ({ child, leg })),
    );
    if (mineLegs.length === 0) return empty;

    // 노선 칸 → 정류장 마스터 → 좌표. ⚠️ admin은 RLS 우회라 tenant_id 필터 필수([[#104]]).
    const admin = createAdminClient();
    const runStopIds = [...new Set(mineLegs.flatMap(({ leg }) => leg.route.filter((r) => r.kind === "stop").map((r) => r.id)))];
    const stopIdOf = new Map<string, string>();
    const coords = new Map<string, { lat: number; lng: number }>();
    if (runStopIds.length > 0) {
      const { data: runStops, error: rsError } = await admin
        .from("shuttle_run_stops")
        .select("id, stop_id")
        .eq("tenant_id", viewer.tenantId)
        .in("id", runStopIds);
      if (rsError) throw rsError;
      for (const r of runStops ?? []) if (r.stop_id) stopIdOf.set(String(r.id), String(r.stop_id));
      const stopIds = [...new Set(stopIdOf.values())];
      if (stopIds.length > 0) {
        const { data: stops, error } = await admin
          .from("shuttle_stops")
          .select("id, lat, lng")
          .eq("tenant_id", viewer.tenantId)
          .in("id", stopIds);
        // 0244a 전 DB면 좌표 칸이 없다 — 좌표 없이 간다(이름은 그대로).
        if (!error) {
          for (const s of stops ?? []) {
            if (typeof s.lat === "number" && typeof s.lng === "number") coords.set(String(s.id), { lat: s.lat, lng: s.lng });
          }
        }
      }
    }

    const out: ParentLiveLeg[] = mineLegs.map(({ child, leg }) => {
      const roles = routeRoles(leg.route, leg.direction);
      const mine = leg.route.find((r) => r.mine);
      return {
        key: leg.key,
        runId: leg.runId,
        direction: leg.direction,
        kidName: child.name,
        vehicleName: leg.vehicleName,
        runName: leg.runName,
        stopName: mine?.name ?? leg.stopName,
        time: mine?.time ?? leg.plannedTime,
        trip: leg.trip,
        route: leg.route.map((r) => {
          const c = r.kind === "stop" ? coords.get(stopIdOf.get(r.id) ?? "") : { lat: ACADEMY_LOCATION.lat, lng: ACADEMY_LOCATION.lng };
          const role = roles.get(r.id);
          return { id: r.id, kind: r.kind, name: r.name, time: r.time, lat: c?.lat ?? null, lng: c?.lng ?? null, ...(role ? { role } : {}) };
        }),
      };
    });
    out.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
    return { legs: out };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentLive" });
    return empty;
  }
}
