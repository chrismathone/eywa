import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";

/** 관리자 '가까운 노선 찾기' 왼쪽 학생 목록 한 줄 — 주소는 위치 찾기에만 쓴다(화면에 그대로 적지 않는다). */
export type NearbyStudent = {
  id: string;
  name: string;
  school: string;
  grade: string;
  address: string | null;
  /** 이미 배정된 **탈 곳**(학기중 · 등원 정류장 우선) — 좌표가 있을 때만. 있으면 집 주소보다 먼저 쓴다(사용자 2026-10-26). */
  boardStop: { name: string; lat: number; lng: number; runId: string } | null;
};

/**
 * 재원생 목록(학교별로 묶는 재료) — 관리자 '가까운 노선 찾기'(사용자 2026-10-26 "왼쪽에 애들 목록을 학교별로").
 * 🔒 부르는 쪽(페이지)이 `isShuttleAdmin`을 확인한 뒤 그 학원으로 부른다. admin 클라이언트라 **tenant_id 필터 필수**([[#104]]).
 * 🔑 테스트 학생(`is_test`)은 뺀다. 재원생만(B2 — 수백 명이라 상한 2000, 넘으면 잘림을 알린다).
 * ⚠️ 실패해도 화면은 산다(빈 목록 + 사유).
 */
export async function loadNearbyStudents(tenantId: string): Promise<{ students: NearbyStudent[]; error: string | null }> {
  try {
    const admin = createAdminClient();
    // 서로 독립 — 함께 받는다(B4). 학원 하나의 배정·노선은 수백 행이라 상한 안(B2).
    const [studentsRes, ridersRes, runStopsRes, runsRes, stopsRes] = await Promise.all([
      admin.from("students")
      .select("id, name, school, grade, address, is_test")
      .eq("tenant_id", tenantId)
      .eq("status", "enrolled")
      .order("name")
      .limit(2000),
      admin.from("shuttle_riders").select("student_id, run_stop_id").eq("tenant_id", tenantId).limit(5000),
      admin.from("shuttle_run_stops").select("id, run_id, stop_id").eq("tenant_id", tenantId).limit(5000),
      admin.from("shuttle_runs").select("id, direction").eq("tenant_id", tenantId).eq("season", "term").limit(1000),
      admin.from("shuttle_stops").select("id, name, lat, lng").eq("tenant_id", tenantId).limit(2000),
    ]);
    for (const r of [studentsRes, ridersRes, runStopsRes, runsRes, stopsRes]) if (r.error) throw r.error;
    const data = studentsRes.data;

    // 학생 → 탈 곳: 학기중 회차의 배정만, 등원 정류장이 있으면 그것(타는 곳), 없으면 하원 정류장. 좌표 없는 정류장은 못 쓴다.
    const runDir = new Map((runsRes.data ?? []).map((r) => [r.id as string, r.direction as string]));
    const runStop = new Map((runStopsRes.data ?? []).map((rs) => [rs.id as string, { runId: rs.run_id as string, stopId: rs.stop_id as string | null }]));
    const stopById = new Map(
      (stopsRes.data ?? []).flatMap((st) => (st.lat != null && st.lng != null ? [[st.id as string, { name: st.name as string, lat: Number(st.lat), lng: Number(st.lng) }] as const] : [])),
    );
    const board = new Map<string, { stop: NonNullable<NearbyStudent["boardStop"]>; isIn: boolean }>();
    for (const rd of ridersRes.data ?? []) {
      const rs = runStop.get(rd.run_stop_id as string);
      const dir = rs ? runDir.get(rs.runId) : undefined;
      const stop = rs?.stopId ? stopById.get(rs.stopId) : undefined;
      if (!dir || !stop) continue;
      const prev = board.get(rd.student_id as string);
      if (!prev || (!prev.isIn && dir === "in")) board.set(rd.student_id as string, { stop: { ...stop, runId: rs!.runId }, isIn: dir === "in" });
    }
    const students = (data ?? [])
      .filter((s) => !s.is_test)
      .map((s) => ({
        id: s.id as string,
        name: s.name as string,
        school: ((s.school as string | null) ?? "").trim(),
        grade: String(s.grade ?? "").trim(),
        address: ((s.address as string | null) ?? "").trim() || null,
        boardStop: board.get(s.id as string)?.stop ?? null,
      }));
    return { students, error: null };
  } catch (e) {
    reportError(e, { scope: "shuttle.staffNearbyStudents" });
    return { students: [], error: "학생 목록을 불러오지 못했어요" };
  }
}
