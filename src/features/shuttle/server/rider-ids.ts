import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import type { Season } from "../types";

/**
 * 셔틀에 **배정된 학생 id** — 시간표 '셔틀 탑승 학생만' 보기의 재료(사용자 2026-10-27).
 * 그 시즌 회차 → 정류장 칸 → 탑승자. 학생 이름·연락처는 읽지 않는다(id만).
 * 🔒 부르는 쪽이 로그인·권한을 확인한 뒤 그 학원으로 부른다. admin 클라이언트라 **tenant_id 필터 필수**([[#104]]).
 * ⚠️ 실패하면 null — 빈 집합으로 삼키면 "셔틀 타는 학생 0명"이라는 거짓 화면이 된다(부르는 쪽이 안내한다).
 */
export async function loadShuttleRiderIds(tenantId: string, season: Season = "term"): Promise<Set<string> | null> {
  try {
    const admin = createAdminClient();
    const [runsRes, runStopsRes, ridersRes] = await Promise.all([
      admin.from("shuttle_runs").select("id").eq("tenant_id", tenantId).eq("season", season).limit(1000),
      admin.from("shuttle_run_stops").select("id, run_id").eq("tenant_id", tenantId).limit(5000),
      admin.from("shuttle_riders").select("student_id, run_stop_id").eq("tenant_id", tenantId).limit(5000),
    ]);
    for (const r of [runsRes, runStopsRes, ridersRes]) if (r.error) throw r.error;
    const runIds = new Set((runsRes.data ?? []).map((r) => r.id as string));
    const okStops = new Set((runStopsRes.data ?? []).filter((rs) => runIds.has(rs.run_id as string)).map((rs) => rs.id as string));
    return new Set((ridersRes.data ?? []).filter((r) => okStops.has(r.run_stop_id as string)).map((r) => r.student_id as string));
  } catch (e) {
    reportError(e, { scope: "shuttle.riderIds" });
    return null;
  }
}
