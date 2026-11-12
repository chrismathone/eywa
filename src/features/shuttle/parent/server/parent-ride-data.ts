import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import {
  buildRideLegs,
  buildVehicleRoutes,
  type RegularStop,
  type RideLeg,
  type RideLogInput,
  type VehicleFleet,
} from "../parent-rides";
import { dayCodeOf, type RideException } from "../../roster";
import { isMissingNotifyColumn } from "../notify-column";
import { parentPortalAvailable } from "./parent-availability";
import type { ParentViewer } from "./parent-viewer";
import {
  isBoardingStatus,
  isDirection,
  isRideExceptionKind,
  type DayCode,
  type Direction,
  type RunStopKind,
  type Season,
  type ShuttleRun,
  type ShuttleTrip,
} from "../../types";

export type ParentRideData = {
  legs: Map<string, RideLeg[]>;
  /** 학원의 호차 전부(차량 정렬순)와 각 전체 노선. `withVehicleRoutes`일 때만 채운다(학부모 '수정하기' 모달). */
  fleet: VehicleFleet[];
  /**
   * 그 요일의 **고정(정기) 자리** — 아이·방향마다 노선 칸 id. `withVehicleRoutes`일 때만(고정 시간 변경 창 재료).
   * 🔑 날짜 하루짜리 변경은 섞지 않는다 — "매주 이 요일엔 원래 어디서 타나"만.
   */
  regular: RegularStop[];
};

const EMPTY = (): ParentRideData => ({ legs: new Map(), fleet: [], regular: [] });

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 학부모 경로 전용 읽기 문 — 포털 이용 가능 상태와 **이 학부모에게 연결된 아이**를 다시 확인한 뒤 공용 조립기로 간다.
 * 직원 셔틀 화면도 아래 `loadRideLegsFor`를 쓰므로 그 함수에 학부모 신원 문을 섞지 않는다.
 */
export async function loadParentRideLegsFor(
  viewer: ParentViewer,
  studentIds: readonly string[],
  ymd: string,
  season: Season,
  live: boolean,
  withVehicleRoutes = false,
): Promise<ParentRideData> {
  if (studentIds.length === 0 || !(await parentPortalAvailable(viewer))) return EMPTY();
  const linked = new Set(viewer.children.map((child) => child.id));
  if (studentIds.some((studentId) => !linked.has(studentId))) return EMPTY();
  return loadRideLegsFor(viewer.tenantId, [...studentIds], ymd, season, live, withVehicleRoutes);
}

/**
 * 학부모 뷰 재료 — **주어진 아이들의 셔틀만** service_role로 읽는다.
 *
 * 🔴 호출부는 `getParentViewer()`가 돌려준 아이 id만 넘긴다(학부모 세션은 RLS로 아무것도 못 읽는다).
 *    모든 조회에 `tenant_id`를 건다 — admin은 RLS를 우회하므로 이 필터가 곧 지점 격리다.
 * 🔑 노선은 **그 회차 전체**(정류장 이름·시각)를 읽지만 **다른 아이 배정은 읽지 않는다** — 배정은 이 아이들
 *    것만 조회하므로 다른 아이 이름이 이 화면 재료에 들어올 길이 없다.
 * 🔑 그날만 변경(0229a)은 **어느 날짜든** 읽는다(학부모가 미리 바꾼 요일에 보여야 한다, 2026-09-29).
 *    실제 기록·운행 상태는 `live`(오늘)일 때만 — 다른 날은 아직 일어나지 않았다.
 * 🔑 `withVehicleRoutes`면 **학원의 모든 호차 노선**(정류장 이름·시각)도 읽는다 — 역시 다른 아이 배정은 읽지 않는다.
 *    학부모가 모달에서 호차를 바꿔 가며 다른 차의 노선도 본다.
 * 🔴 변경 내역(0321a 장부)은 **읽지 않는다** — 직원 전용이다(사용자 2026-09-29 "관리자나 셔틀 선생님만").
 *    직원 화면은 `getRideChangesOn`(queries.ts, 세션 + RLS)으로 따로 읽는다.
 * 실패하면 빈 결과로 접고 계측만 남긴다 — 학부모 화면을 500으로 죽이지 않는다.
 */
export async function loadRideLegsFor(
  tenantId: string,
  studentIds: string[],
  ymd: string,
  season: Season,
  live: boolean,
  withVehicleRoutes = false,
): Promise<ParentRideData> {
  if (studentIds.length === 0) return EMPTY();
  try {
    return await load(tenantId, studentIds, ymd, season, live, withVehicleRoutes);
  } catch (e) {
    reportError(e, { scope: "shuttle.parentRides", ymd });
    return EMPTY();
  }
}

const none = { data: [] as never[], error: null };

async function load(
  tenantId: string,
  studentIds: string[],
  ymd: string,
  season: Season,
  live: boolean,
  withVehicleRoutes: boolean,
): Promise<ParentRideData> {
  const admin = createAdminClient();
  const [ridersRes, exceptionsRes, logsFirst] = await Promise.all([
    admin.from("shuttle_riders").select("id, run_stop_id, student_id, io_kind, weekdays, memo")
      .eq("tenant_id", tenantId).in("student_id", studentIds).limit(200),
    // 그날만 변경은 **어느 날짜든** 읽는다 — 학부모가 이번 주 다른 요일을 미리 바꿀 수 있어서(0321a).
    admin.from("shuttle_ride_exceptions").select("id, student_id, kind, io_kind, run_stop_id, memo")
      .eq("tenant_id", tenantId).eq("on_date", ymd).in("student_id", studentIds).limit(100),
    live
      ? admin.from("shuttle_boardings").select("id, student_id, run_id, stop_label, io_kind, status, memo, recorded_at, notify_parent")
          .eq("tenant_id", tenantId).eq("boarded_on", ymd).in("student_id", studentIds).limit(100)
      : Promise.resolve(none),
  ]);
  // ⚠️ 0368c(notify_parent) 전 DB면 그 칸만 빼고 다시 읽는다 — 안 그러면 학부모 화면 전체가 "셔틀 일정이 없어요"로
  //    접힌다(notify-column.ts). 그때 기록은 전부 알림 대상으로 친다.
  const logsRes = isMissingNotifyColumn(logsFirst.error)
    ? await admin.from("shuttle_boardings").select("id, student_id, run_id, stop_label, io_kind, status, memo, recorded_at")
        .eq("tenant_id", tenantId).eq("boarded_on", ymd).in("student_id", studentIds).limit(100)
        .then((r) => ({ ...r, data: (r.data ?? []).map((l) => ({ ...l, notify_parent: true })) }))
    : logsFirst;
  for (const res of [ridersRes, exceptionsRes, logsRes]) if (res.error) throw res.error;
  const riders = (ridersRes.data ?? []).filter((r) => isDirection(r.io_kind));

  const exceptions: RideException[] = (exceptionsRes.data ?? [])
    .filter((e) => isDirection(e.io_kind) && isRideExceptionKind(e.kind))
    .map((e) => ({
      id: e.id, studentId: e.student_id, studentName: "", schoolGrade: "", studentStatus: "enrolled",
      kind: e.kind as RideException["kind"], ioKind: e.io_kind as RideException["ioKind"], runStopId: e.run_stop_id, memo: e.memo,
    }));
  const logs: RideLogInput[] = (logsRes.data ?? [])
    .filter((l) => isDirection(l.io_kind) && isBoardingStatus(l.status))
    .map((l) => ({
      id: l.id, studentId: l.student_id, runId: l.run_id, ioKind: l.io_kind as RideLogInput["ioKind"],
      status: l.status as RideLogInput["status"], memo: l.memo, stopLabel: l.stop_label, recordedAt: l.recorded_at,
      notifyParent: l.notify_parent !== false,
    }));

  // ① 이 아이들이 걸린 노선 칸(정기 배정 ∪ 오늘만 탐) → 그 칸들의 회차.
  const ownStopIds = [...new Set([...riders.map((r) => r.run_stop_id), ...exceptions.flatMap((e) => (e.runStopId ? [e.runStopId] : []))])];
  const { data: ownStops, error: ownError } = ownStopIds.length
    ? await admin.from("shuttle_run_stops").select("id, run_id").eq("tenant_id", tenantId).in("id", ownStopIds)
    : none;
  if (ownError) throw ownError;
  const runIds = [...new Set([...(ownStops ?? []).map((r) => r.run_id), ...logs.flatMap((l) => (l.runId ? [l.runId] : []))])];
  if (runIds.length === 0) return EMPTY();

  // ② 그 회차들의 **노선 전체** + 회차·운행 상태.
  const [routeRes, runsRes, tripsRes] = await Promise.all([
    admin.from("shuttle_run_stops").select("id, run_id, kind, stop_id, sort_order, at_time").eq("tenant_id", tenantId).in("run_id", runIds).limit(500),
    admin.from("shuttle_runs").select("id, vehicle_id, season, run_no, direction, label").eq("tenant_id", tenantId).in("id", runIds),
    live
      ? admin.from("shuttle_trips").select("id, run_id, started_at, ended_at, memo").eq("tenant_id", tenantId).eq("ran_on", ymd).in("run_id", runIds)
      : Promise.resolve(none),
  ]);
  for (const res of [routeRes, runsRes]) if (res.error) throw res.error;
  const runRows = (runsRes.data ?? []).filter((r) => r.season === season && isDirection(r.direction));
  if (runRows.length === 0) return EMPTY();

  const stopIds = [...new Set((routeRes.data ?? []).flatMap((r) => (r.stop_id ? [r.stop_id] : [])))];
  const [stopsRes, vehiclesRes] = await Promise.all([
    stopIds.length ? admin.from("shuttle_stops").select("id, name").eq("tenant_id", tenantId).in("id", stopIds) : Promise.resolve(none),
    admin.from("shuttle_vehicles").select("id, name").eq("tenant_id", tenantId).in("id", [...new Set(runRows.map((r) => r.vehicle_id))]),
  ]);
  for (const res of [stopsRes, vehiclesRes]) if (res.error) throw res.error;

  const stopName = new Map((stopsRes.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
  const runs: ShuttleRun[] = runRows.map((r) => ({
    id: r.id, vehicleId: r.vehicle_id, season, runNo: r.run_no, direction: r.direction as ShuttleRun["direction"], label: r.label,
    stops: (routeRes.data ?? []).filter((rs) => rs.run_id === r.id).map((rs) => {
      const kind: RunStopKind = rs.kind === "depart" || rs.kind === "arrive" ? rs.kind : "stop";
      return {
        id: rs.id, kind, stopId: rs.stop_id, stopMemo: null, sortOrder: rs.sort_order,
        stopName: kind === "depart" ? "학원 출발" : kind === "arrive" ? "학원 도착" : (rs.stop_id && stopName.get(rs.stop_id)) || "정류장",
        atTime: rs.at_time ? rs.at_time.slice(0, 5) : null,
        riders: riders.filter((x) => x.run_stop_id === rs.id).map((x) => ({
          id: x.id, studentId: x.student_id, studentName: "", schoolGrade: "", ioKind: x.io_kind as ShuttleRun["direction"],
          weekdays: (x.weekdays ?? []) as DayCode[], memo: x.memo, studentStatus: "enrolled",
        })),
      };
    }),
  }));

  // 운행 표(0243a)가 없으면 운행 상태를 '모름'으로 둔다(출발 전이라고 말하지 않는다).
  const trips = new Map<string, ShuttleTrip>();
  for (const t of (tripsRes.data ?? []) as { id: string; run_id: string | null; started_at: string | null; ended_at: string | null; memo: string | null }[]) {
    if (t.run_id) trips.set(t.run_id, { id: t.id, runId: t.run_id, startedAt: t.started_at, endedAt: t.ended_at, startedByName: null, endedByName: null, memo: t.memo });
  }
  const built = buildRideLegs({
    ymd, runs, vehicles: vehiclesRes.data ?? [], exceptions, logs, trips, tripsReady: live && !tripsRes.error,
  });
  // 🔴 직원 메모(탑승 기록 메모 포함)는 **여기서 지운다** — 구간이 학부모 화면의 클라이언트 컴포넌트(수정 모달)로 그대로 넘어가서,
  //    화면에 안 그려도 브라우저로 전송된다(2026-09-29 발견).
  // 🔑 그날 바뀐 사유(`changeNote` — 이동·안 탐·결석 줄의 메모)는 남긴다: 학부모에게도 보인다(사용자 2026-10-20).
  const legs = new Map([...built].map(([id, list]) => [id, list.map((l) => ({ ...l, staffMemo: null }))]));
  const fleet = withVehicleRoutes ? await loadFleet(admin, tenantId, season) : [];
  const day = dayCodeOf(ymd);
  const regular: RegularStop[] = withVehicleRoutes
    ? riders
        .filter((r) => ((r.weekdays ?? []) as string[]).includes(day))
        .map((r) => ({ studentId: r.student_id, direction: r.io_kind as Direction, runStopId: r.run_stop_id }))
    : [];
  return { legs, fleet, regular };
}

/** 학원의 운행 중인 호차 전부(차량 정렬순) + 각 호차의 그 시즌 회차 — 정류장 이름·시각만(배정·기사 연락처 없음). */
async function loadFleet(admin: Admin, tenantId: string, season: Season): Promise<VehicleFleet[]> {
  const [vehiclesRes, runsRes] = await Promise.all([
    admin.from("shuttle_vehicles").select("id, name, sort_order")
      .eq("tenant_id", tenantId).eq("archived", false).order("sort_order").limit(50),
    admin.from("shuttle_runs").select("id, vehicle_id, run_no, direction, label")
      .eq("tenant_id", tenantId).eq("season", season).limit(300),
  ]);
  for (const res of [vehiclesRes, runsRes]) if (res.error) throw res.error;
  const vehicles = vehiclesRes.data ?? [];
  const runs = (runsRes.data ?? []).filter((r) => isDirection(r.direction));
  if (vehicles.length === 0 || runs.length === 0) {
    return vehicles.map((v) => ({ id: v.id, name: v.name, routes: [] }));
  }

  const { data: routeRows, error: routeError } = await admin.from("shuttle_run_stops")
    .select("id, run_id, kind, stop_id, sort_order, at_time")
    .eq("tenant_id", tenantId).in("run_id", runs.map((r) => r.id)).limit(1000);
  if (routeError) throw routeError;
  const stopIds = [...new Set((routeRows ?? []).flatMap((r) => (r.stop_id ? [r.stop_id] : [])))];
  const { data: stopRows, error: stopsError } = stopIds.length
    ? await admin.from("shuttle_stops").select("id, name").eq("tenant_id", tenantId).in("id", stopIds)
    : none;
  if (stopsError) throw stopsError;
  const stopName = new Map((stopRows ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));

  const routes = buildVehicleRoutes(runs.map((r): ShuttleRun => ({
    id: r.id, vehicleId: r.vehicle_id, season, runNo: r.run_no, direction: r.direction as ShuttleRun["direction"], label: r.label,
    stops: (routeRows ?? []).filter((rs) => rs.run_id === r.id).map((rs) => {
      const kind: RunStopKind = rs.kind === "depart" || rs.kind === "arrive" ? rs.kind : "stop";
      return {
        id: rs.id, kind, stopId: rs.stop_id, stopMemo: null, sortOrder: rs.sort_order,
        stopName: kind === "depart" ? "학원 출발" : kind === "arrive" ? "학원 도착" : (rs.stop_id && stopName.get(rs.stop_id)) || "정류장",
        atTime: rs.at_time ? rs.at_time.slice(0, 5) : null,
        riders: [],
      };
    }),
  })));
  return vehicles.map((v) => ({ id: v.id, name: v.name, routes: routes.get(v.id) ?? [] }));
}
