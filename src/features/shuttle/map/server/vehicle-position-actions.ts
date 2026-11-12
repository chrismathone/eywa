"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { checkReport, type PositionReport, type VehiclePosition } from "../vehicle-position";
import { isShuttleAdmin } from "../../server/access";
import { parentPortalAvailable } from "../../parent/server/parent-availability";
import { loadParentRideLegsFor } from "../../parent/server/parent-ride-data";
import { getParentViewer } from "../../parent/server/parent-viewer";
import { canRecordBoarding } from "../../server/record-gate";
import { loadRunningPositions } from "./vehicle-position-core";

/**
 * 기사 폰 → 차량 위치 한 번(0383a, 사용자 2026-10-15 "GPS 기능").
 * 🔒 등하원 **기록 권한**(`canRecordBoarding` — 셔틀 담당·사무실·총괄)이 있고, 그 회차가 **오늘 운행 중**(출발했고 종료 전)일 때만.
 *    출발 전·종료 뒤엔 받지 않는다 — 기사가 집에 가는 길이 학부모 지도에 찍히면 안 된다.
 * 🔑 회차마다 최신 한 줄 upsert. 값 검증은 순수 모듈(`checkReport`) — 이상한 좌표·큰 오차는 버린다.
 */
export async function reportVehiclePosition(input: PositionReport): Promise<{ ok: true } | { error: string }> {
  // 보낸 사람(sent_by)은 화면 주인 — 강사뷰면 검증된 대상(자격 canRecordBoarding과 같은 사람).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) return { error: "위치를 보낼 권한이 없습니다" };
  const checked = checkReport(input);
  if (!checked.ok) return { error: checked.error };
  const v = checked.value;
  const ranOn = kstToday();
  try {
    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("shuttle_trips")
      .select("started_at, ended_at")
      .eq("tenant_id", user.tenantId)
      .eq("ran_on", ranOn)
      .eq("run_id", v.runId)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip?.started_at) return { error: "출발 전이라 위치를 보내지 않습니다" };
    if (trip.ended_at) return { error: "운행이 종료돼 위치를 보내지 않습니다" };

    const { error } = await admin.from("shuttle_vehicle_positions").upsert(
      {
        tenant_id: user.tenantId,
        ran_on: ranOn,
        run_id: v.runId,
        lat: v.lat,
        lng: v.lng,
        accuracy_m: v.accuracyM,
        heading: v.heading,
        speed_mps: v.speedMps,
        measured_at: v.measuredAt,
        received_at: new Date().toISOString(),
        sent_by: user.id,
      },
      { onConflict: "tenant_id,ran_on,run_id" },
    );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    reportError(e, { scope: "shuttle.reportPosition" });
    return { error: "위치를 저장하지 못했습니다" };
  }
}

/** 관리자 '실시간 위치' — 오늘 운행 중인 모든 회차의 차 위치. 원장·관리자·총괄 전용(`isShuttleAdmin`). */
export async function getStaffVehiclePositions(): Promise<VehiclePosition[]> {
  const user = await getCurrentUser();
  if (!user || !(await isShuttleAdmin())) return [];
  return loadRunningPositions(user.tenantId, kstToday(), null);
}

/**
 * 학부모 '실시간 차량' — **우리 아이가 오늘 타는 회차**의 차 위치만.
 * 🔒 회차 목록은 `getParentViewer`의 아이들 오늘 구간에서 서버가 정한다(화면이 넘긴 id를 믿지 않는다). 오늘만 안 타는 구간은 제외.
 */
export async function getParentVehiclePositions(): Promise<VehiclePosition[]> {
  const viewer = await getParentViewer();
  if (!viewer || viewer.children.length === 0 || !(await parentPortalAvailable(viewer))) return [];
  const ymd = kstToday();
  const { legs } = await loadParentRideLegsFor(viewer, viewer.children.map((c) => c.id), ymd, "term", true);
  const runIds = [...new Set([...legs.values()].flatMap((list) => list.filter((l) => !l.skipped).map((l) => l.runId)))];
  return loadRunningPositions(viewer.tenantId, ymd, runIds);
}
