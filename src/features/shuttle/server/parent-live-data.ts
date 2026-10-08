import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { DIRECTION_LABEL, type Direction } from "../types";
import { loadRideLegsFor } from "./parent-ride-data";
import type { ParentViewer } from "./parent-viewer";

/** 학부모 '실시간 차량' 지도에 찍을 우리 아이의 오늘 정류장 하나. */
export type ParentLiveStop = {
  /** 정류장 마스터 id — 같은 정류장에서 등·하원을 다 하면 한 점으로 묶는다. */
  stopId: string;
  name: string;
  /** "김민준 등원 14:40" 같은 줄들. */
  lines: string[];
  lat: number | null;
  lng: number | null;
};

export type ParentLiveData = {
  stops: ParentLiveStop[];
  /** 좌표가 찍힌 정류장 수 — 지도에 실제로 점이 몇 개 뜨는지. */
  withCoords: number;
};

/**
 * 학부모 '실시간 차량' 재료(사용자 2026-10-08 "학부모 계정 실시간 차량에 지도를 띄우는 것부터") — **우리 아이가 오늘 타고
 * 내리는 정류장**과 그 좌표(0244a).
 *
 * 🔴 차량 위치는 아직 없다(기사 폰 GPS 전송 미구현) — 여기서도 지어내지 않는다. 지도엔 정류장만 찍는다.
 * 🔴 아이 목록은 `getParentViewer()`가 준 것만, 정류장은 그 아이들의 오늘 구간에서 `mine`인 칸만 — 다른 아이·다른 정류장은 싣지 않는다.
 * ⚠️ 좌표 칸(0244a)이 없거나 조회가 실패하면 좌표 없이 이름만 돌려준다(지도는 기본 위치로 뜬다).
 */
export async function loadParentLiveData(viewer: ParentViewer): Promise<ParentLiveData> {
  const empty: ParentLiveData = { stops: [], withCoords: 0 };
  if (viewer.children.length === 0) return empty;
  try {
    const { legs } = await loadRideLegsFor(viewer.tenantId, viewer.children.map((c) => c.id), kstToday(), "term", true);

    // 아이 구간 → 내 노선 칸(run_stop) id와 그 줄 설명.
    const linesByRunStop = new Map<string, { name: string; lines: string[] }>();
    for (const child of viewer.children) {
      for (const leg of legs.get(child.id) ?? []) {
        if (leg.skipped) continue;
        const mine = leg.route.find((r) => r.mine);
        if (!mine) continue;
        const entry = linesByRunStop.get(mine.id) ?? { name: mine.name, lines: [] };
        entry.lines.push(`${child.name} ${DIRECTION_LABEL[leg.direction as Direction]}${mine.time ? ` ${mine.time}` : ""}`);
        linesByRunStop.set(mine.id, entry);
      }
    }
    if (linesByRunStop.size === 0) return empty;

    // 노선 칸 → 정류장 마스터 → 좌표. ⚠️ admin은 RLS 우회라 tenant_id 필터 필수([[#104]]).
    const admin = createAdminClient();
    const { data: runStops, error: rsError } = await admin
      .from("shuttle_run_stops")
      .select("id, stop_id")
      .eq("tenant_id", viewer.tenantId)
      .in("id", [...linesByRunStop.keys()]);
    if (rsError) throw rsError;
    const stopIdOf = new Map((runStops ?? []).flatMap((r) => (r.stop_id ? [[String(r.id), String(r.stop_id)] as const] : [])));

    const stopIds = [...new Set(stopIdOf.values())];
    const coords = new Map<string, { lat: number; lng: number }>();
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

    // 같은 정류장(마스터)은 한 점으로 묶는다 — 등원·하원을 같은 곳에서 하면 줄만 늘어난다.
    const byStop = new Map<string, ParentLiveStop>();
    for (const [runStopId, entry] of linesByRunStop) {
      const stopId = stopIdOf.get(runStopId) ?? runStopId;
      const c = coords.get(stopId);
      const prev = byStop.get(stopId);
      if (prev) prev.lines.push(...entry.lines);
      else byStop.set(stopId, { stopId, name: entry.name, lines: [...entry.lines], lat: c?.lat ?? null, lng: c?.lng ?? null });
    }
    const stops = [...byStop.values()];
    return { stops, withCoords: stops.filter((s) => s.lat !== null).length };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentLive" });
    return empty;
  }
}
