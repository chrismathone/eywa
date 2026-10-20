import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { doneIndexOf } from "../route-progress";
import type { VehiclePosition } from "../vehicle-position";

/**
 * 오늘 **운행 중인 회차**의 최신 차량 위치(0383a). `runIds`를 주면 그 회차만(학부모 — 우리 아이 회차).
 *
 * 🔑 운행 중 판정은 `shuttle_trips`(0243a)가 진실 — 출발했고 아직 종료 안 된 회차만 돌려준다. 종료된 회차의 마지막
 *    위치는 남아 있어도 지도에 그리지 않는다(차는 이미 학원에 있다).
 * 🔒 권한 확인은 부르는 쪽(vehicle-position-actions.ts). 이 모듈은 server-only. admin이라 tenant 필터 필수([[#104]]).
 * ⚠️ 표(0383a)가 없거나 조회가 실패하면 빈 목록 — 지도는 차 없이 그대로 뜬다.
 */
export async function loadRunningPositions(tenantId: string, ymd: string, runIds: string[] | null): Promise<VehiclePosition[]> {
  if (runIds && runIds.length === 0) return [];
  try {
    const admin = createAdminClient();
    let trips = admin
      .from("shuttle_trips")
      .select("run_id, started_at")
      .eq("tenant_id", tenantId)
      .eq("ran_on", ymd)
      .not("started_at", "is", null)
      .is("ended_at", null)
      .limit(100);
    if (runIds) trips = trips.in("run_id", runIds);
    const { data: running, error: tripError } = await trips;
    if (tripError) throw tripError;
    const runningIds = (running ?? []).flatMap((t) => (t.run_id ? [String(t.run_id)] : []));
    if (runningIds.length === 0) return [];
    const startedAt = new Map((running ?? []).flatMap((t) => (t.run_id && t.started_at ? [[String(t.run_id), String(t.started_at)] as const] : [])));

    // 🔑 진행 칸(사용자 2026-10-15 "시간 기준이 아니라 출발 뒤 탑승·하원 체크로") — 출발 뒤 찍힌 기록(탑승·미탑승·하차)의
    //    정류장 중 노선에서 가장 뒤 칸. 기록은 **정류장 id만** 쓴다(다른 아이 이름·상태는 싣지 않는다).
    const [posRes, stopsRes, logsRes] = await Promise.all([
      admin
        .from("shuttle_vehicle_positions")
        .select("run_id, lat, lng, accuracy_m, heading, speed_mps, received_at")
        .eq("tenant_id", tenantId)
        .eq("ran_on", ymd)
        .in("run_id", runningIds)
        .limit(100),
      admin
        .from("shuttle_run_stops")
        .select("run_id, stop_id, kind, sort_order")
        .eq("tenant_id", tenantId)
        .in("run_id", runningIds)
        .order("sort_order", { ascending: true })
        .limit(1000),
      admin
        .from("shuttle_boardings")
        .select("run_id, stop_id, recorded_at")
        .eq("tenant_id", tenantId)
        .eq("boarded_on", ymd)
        .in("run_id", runningIds)
        .limit(1000),
    ]);
    if (posRes.error) throw posRes.error;
    const data = posRes.data;
    const routeOf = new Map<string, { stopId: string | null; kind: string }[]>();
    for (const rs of stopsRes.data ?? []) {
      const list = routeOf.get(String(rs.run_id)) ?? [];
      list.push({ stopId: rs.stop_id ? String(rs.stop_id) : null, kind: String(rs.kind) });
      routeOf.set(String(rs.run_id), list);
    }
    const recordStops = new Map<string, string[]>();
    for (const l of logsRes.data ?? []) {
      const runId = String(l.run_id);
      const start = startedAt.get(runId);
      // 출발 전에 찍힌 것(하원 체크 등)은 진행이 아니다.
      if (!l.stop_id || !start || Date.parse(String(l.recorded_at)) < Date.parse(start)) continue;
      recordStops.set(runId, [...(recordStops.get(runId) ?? []), String(l.stop_id)]);
    }
    return (data ?? []).map((p) => ({
      doneIndex: doneIndexOf(routeOf.get(String(p.run_id)) ?? [], recordStops.get(String(p.run_id)) ?? []),
      runId: String(p.run_id),
      lat: Number(p.lat),
      lng: Number(p.lng),
      accuracyM: p.accuracy_m === null ? null : Number(p.accuracy_m),
      heading: p.heading === null ? null : Number(p.heading),
      speedMps: p.speed_mps === null ? null : Number(p.speed_mps),
      receivedAt: String(p.received_at),
    }));
  } catch (e) {
    reportError(e, { scope: "shuttle.vehiclePositions" });
    return [];
  }
}
