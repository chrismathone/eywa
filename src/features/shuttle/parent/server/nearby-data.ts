import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { isDirection, runShortTitle } from "../../types";
import type { NetRun, NetStop } from "../nearby";
import { parentPortalAvailable } from "./parent-availability";
import type { ParentViewer } from "./parent-viewer";

const EMPTY_NETWORK = { stops: [], runs: [] };

/** 학부모 전용 노선망 읽기 — 직원 가까운 노선 화면과 달리 포털 이용 가능 상태를 먼저 본다. */
export async function loadParentNearbyNetwork(viewer: ParentViewer): Promise<{ stops: NetStop[]; runs: NetRun[] }> {
  if (!(await parentPortalAvailable(viewer))) return EMPTY_NETWORK;
  return loadNearbyNetwork(viewer.tenantId);
}

/**
 * 학부모 '가까운 노선 찾기'의 재료 — **좌표 있는 정류장 + 학기중 회차(정류장·시각)**(사용자 2026-10-22).
 *
 * 🔒 부르는 쪽(페이지)이 학부모 로그인을 확인한 뒤 그 학원(tenantId)으로 부른다. admin 클라이언트라 **tenant_id 필터 필수**([[#104]]).
 * 🔑 학생·탑승자 정보는 읽지 않는다 — 정류장 이름·좌표·회차 시각만(다른 아이 정보가 학부모에게 새지 않게).
 * 🔑 시즌은 학부모 실시간 화면과 같은 학기중(`term`).
 * ⚠️ 실패해도 화면은 산다 — 빈 노선망이면 "찾을 수 있는 노선이 없어요"로 보인다.
 */
export async function loadNearbyNetwork(tenantId: string): Promise<{ stops: NetStop[]; runs: NetRun[] }> {
  try {
    const admin = createAdminClient();
    const [stopsRes, runsRes, vehiclesRes] = await Promise.all([
      admin.from("shuttle_stops").select("id, name, lat, lng").eq("tenant_id", tenantId).eq("archived", false).not("lat", "is", null).limit(500),
      admin.from("shuttle_runs").select("id, vehicle_id, run_no, direction, label").eq("tenant_id", tenantId).eq("season", "term").limit(500),
      admin.from("shuttle_vehicles").select("id, name").eq("tenant_id", tenantId).eq("archived", false).limit(100),
    ]);
    if (stopsRes.error) throw stopsRes.error;
    if (runsRes.error) throw runsRes.error;
    if (vehiclesRes.error) throw vehiclesRes.error;

    const vehicleName = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v.name as string]));
    const runRows = (runsRes.data ?? []).filter((r) => vehicleName.has(r.vehicle_id) && isDirection(r.direction));
    const runIds = runRows.map((r) => r.id);
    const cellsRes = runIds.length
      ? await admin
          .from("shuttle_run_stops")
          .select("run_id, kind, stop_id, sort_order, at_time")
          .eq("tenant_id", tenantId)
          .in("run_id", runIds)
          .order("sort_order", { ascending: true })
          .limit(5000)
      : { data: [], error: null };
    if (cellsRes.error) throw cellsRes.error;

    const cellsByRun = new Map<string, { kind: string; stop_id: string | null; at_time: string | null }[]>();
    for (const c of cellsRes.data ?? []) {
      const list = cellsByRun.get(c.run_id) ?? [];
      list.push(c);
      cellsByRun.set(c.run_id, list);
    }

    const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
    const runs: NetRun[] = runRows.map((r) => {
      const cells = cellsByRun.get(r.id) ?? [];
      const direction = r.direction as NetRun["direction"];
      // 학원 기준 시각 — 등원은 학원 도착(arrive 칸, 없으면 마지막 시각), 하원은 학원 출발(depart 칸, 없으면 첫 시각).
      const times = cells.map((c) => hm(c.at_time)).filter((t): t is string => !!t);
      const arrive = hm(cells.find((c) => c.kind === "arrive")?.at_time);
      const depart = hm(cells.find((c) => c.kind === "depart")?.at_time);
      const academyTime = direction === "in" ? (arrive ?? times[times.length - 1] ?? null) : (depart ?? times[0] ?? null);
      return {
        id: r.id,
        vehicleName: vehicleName.get(r.vehicle_id) ?? "",
        runName: runShortTitle({ runNo: r.run_no, direction, label: r.label }),
        direction,
        academyTime,
        stops: cells.filter((c) => c.kind === "stop" && c.stop_id).map((c) => ({ stopId: c.stop_id!, time: hm(c.at_time) })),
      };
    });

    const stops: NetStop[] = (stopsRes.data ?? [])
      .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
      .map((s) => ({ id: s.id, name: s.name, lat: s.lat as number, lng: s.lng as number }));
    return { stops, runs };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentNearby" });
    return EMPTY_NETWORK;
  }
}
