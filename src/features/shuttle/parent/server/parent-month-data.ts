import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { shiftMonth } from "@/lib/month-grid";
import type { MonthBoarding, MonthException, MonthRegular } from "../parent-month";
import { isBoardingStatus, isDirection, type DayCode } from "../../types";
import { parentPortalAvailable } from "./parent-availability";
import type { ParentViewer } from "./parent-viewer";

/**
 * 학부모 '월별' 달력 재료 — **아이 한 명 · 한 달**(사용자 2026-10-01).
 *
 * 🔴 호출부는 `getParentViewer()`가 돌려준 아이 id만 넘긴다(학부모 세션은 RLS로 아무것도 못 읽는다 → service_role).
 *    모든 조회에 `tenant_id`를 건다(admin은 RLS 우회라 이 필터가 곧 학원 격리, [[#104]]).
 * ⚡ 독립 조회는 함께 돈다(B4): 정기 배정 · 그 달 변경 · 그 달 탑승 기록 · 학원 휴일 · 가장 이른 기록 → 왕복 1번 + 변경 자리 글자 1~2번.
 * 🔑 노선 같은 무거운 재료는 여기서 안 읽는다 — 날짜를 눌렀을 때 그날 것만(`loadRideLegsFor`).
 * 실패하면 빈 달력으로 접고 계측만 남긴다(학부모 화면을 500으로 죽이지 않는다).
 */
export type ParentMonthData = {
  regular: MonthRegular[];
  exceptions: MonthException[];
  boardings: MonthBoarding[];
  holidays: Record<string, string>;
  /** 볼 수 있는 가장 이른 달 — 이 아이의 탑승 기록·변경이 처음 있는 달(없으면 null = 이번 달부터). */
  earliestMonth: string | null;
};

const EMPTY: ParentMonthData = { regular: [], exceptions: [], boardings: [], holidays: {}, earliestMonth: null };

export async function loadParentMonth(viewer: ParentViewer, studentId: string, month: string): Promise<ParentMonthData> {
  if (!viewer.children.some((child) => child.id === studentId) || !(await parentPortalAvailable(viewer))) return EMPTY;
  try {
    return await load(viewer.tenantId, studentId, month);
  } catch (e) {
    reportError(e, { scope: "shuttle.parentMonth", month });
    return EMPTY;
  }
}

async function load(tenantId: string, studentId: string, month: string): Promise<ParentMonthData> {
  const admin = createAdminClient();
  const from = `${month}-01`;
  const until = `${shiftMonth(month, 1)}-01`; // 다음 달 1일(미포함)

  const [ridersRes, exceptionsRes, boardingsRes, firstBoardRes, firstExRes, settings] = await Promise.all([
    admin.from("shuttle_riders").select("io_kind, weekdays, run_stop_id")
      .eq("tenant_id", tenantId).eq("student_id", studentId).limit(40),
    admin.from("shuttle_ride_exceptions").select("on_date, io_kind, kind, run_stop_id, memo")
      .eq("tenant_id", tenantId).eq("student_id", studentId).gte("on_date", from).lt("on_date", until).limit(200),
    admin.from("shuttle_boardings").select("boarded_on, io_kind, status")
      .eq("tenant_id", tenantId).eq("student_id", studentId).gte("boarded_on", from).lt("boarded_on", until).limit(300),
    admin.from("shuttle_boardings").select("boarded_on")
      .eq("tenant_id", tenantId).eq("student_id", studentId).order("boarded_on", { ascending: true }).limit(1),
    admin.from("shuttle_ride_exceptions").select("on_date")
      .eq("tenant_id", tenantId).eq("student_id", studentId).order("on_date", { ascending: true }).limit(1),
    getTenantSettingsByTenantId(tenantId),
  ]);
  for (const res of [ridersRes, exceptionsRes, boardingsRes, firstBoardRes, firstExRes]) if (res.error) throw res.error;

  const regular: MonthRegular[] = (ridersRes.data ?? [])
    .filter((r) => isDirection(r.io_kind))
    .map((r) => ({ direction: r.io_kind as MonthRegular["direction"], weekdays: (r.weekdays ?? []) as DayCode[], runStopId: r.run_stop_id as string }));

  const rawExceptions = (exceptionsRes.data ?? []).filter(
    (e) => isDirection(e.io_kind) && (e.kind === "add" || e.kind === "skip"),
  );
  const labels = await stopLabels(admin, tenantId, rawExceptions.flatMap((e) => (e.kind === "add" && e.run_stop_id ? [e.run_stop_id as string] : [])));
  const exceptions: MonthException[] = rawExceptions.map((e) => ({
    onDate: String(e.on_date).slice(0, 10),
    direction: e.io_kind as MonthException["direction"],
    kind: e.kind as MonthException["kind"],
    runStopId: (e.run_stop_id as string | null) ?? null,
    memo: (e.memo as string | null) ?? null,
    label: e.run_stop_id ? labels.get(e.run_stop_id as string) ?? null : null,
  }));

  const boardings: MonthBoarding[] = (boardingsRes.data ?? [])
    .filter((b) => isDirection(b.io_kind) && isBoardingStatus(b.status))
    .map((b) => ({ date: String(b.boarded_on).slice(0, 10), direction: b.io_kind as MonthBoarding["direction"], status: b.status as MonthBoarding["status"] }));

  const firsts = [firstBoardRes.data?.[0]?.boarded_on, firstExRes.data?.[0]?.on_date]
    .filter(Boolean)
    .map((d) => String(d).slice(0, 7))
    .sort();

  return {
    regular,
    exceptions,
    boardings,
    holidays: buildHolidayMap(settings.operations.holidays),
    earliestMonth: firsts[0] ?? null,
  };
}

/**
 * 노선 칸 → "1호차 2회차 · 칠성초 정문 18:20". 정류장 이름·시각뿐(다른 아이 정보 없음).
 * 직원 월별(`loadStaffMonth`)도 학원 전체 자리로 부른다 — 칸 id가 많을 수 있어 300개씩 나눠 읽는다.
 */
export async function stopLabels(admin: ReturnType<typeof createAdminClient>, tenantId: string, runStopIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(runStopIds)];
  if (ids.length === 0) return out;
  const stops: { id: string; run_id: string; stop_id: string | null; at_time: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin.from("shuttle_run_stops").select("id, run_id, stop_id, at_time")
      .eq("tenant_id", tenantId).in("id", ids.slice(i, i + 300));
    if (error) throw error;
    stops.push(...((data ?? []) as typeof stops));
  }
  const runIds = [...new Set(stops.map((s) => s.run_id as string))];
  const stopIds = [...new Set(stops.flatMap((s) => (s.stop_id ? [s.stop_id as string] : [])))];
  const [runsRes, namesRes] = await Promise.all([
    admin.from("shuttle_runs").select("id, run_no, label, vehicle_id").eq("tenant_id", tenantId).in("id", runIds),
    stopIds.length
      ? admin.from("shuttle_stops").select("id, name").eq("tenant_id", tenantId).in("id", stopIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  for (const res of [runsRes, namesRes]) if (res.error) throw res.error;
  const vehicleIds = [...new Set((runsRes.data ?? []).map((r) => r.vehicle_id as string))];
  const { data: vehicles, error: vehiclesError } = vehicleIds.length
    ? await admin.from("shuttle_vehicles").select("id, name").eq("tenant_id", tenantId).in("id", vehicleIds)
    : { data: [] as { id: string; name: string }[], error: null };
  if (vehiclesError) throw vehiclesError;
  for (const s of stops) {
    const run = (runsRes.data ?? []).find((r) => r.id === s.run_id);
    const vehicle = (vehicles ?? []).find((v) => v.id === run?.vehicle_id)?.name ?? "";
    const runName = run ? run.label?.trim() || `${run.run_no}회차` : "";
    const stopName = (namesRes.data ?? []).find((n) => n.id === s.stop_id)?.name ?? "정류장";
    const time = s.at_time ? String(s.at_time).slice(0, 5) : "";
    out.set(s.id as string, `${[vehicle, runName].filter(Boolean).join(" ")} · ${stopName}${time ? ` ${time}` : ""}`.trim());
  }
  return out;
}
