import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { reportError } from "@/lib/observability/report-error";
import {
  isBoardingStatus,
  isDirection,
  isRideExceptionKind,
  isSeason,
  type BoardingStatus,
  type DayCode,
  type Direction,
  type RideExceptionKind,
  type Season,
  type ShuttleRider,
  type ShuttleRun,
  type ShuttleRunStop,
  type ShuttleStop,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "../types";
import { dayCodeOf, type RideException } from "../roster";
import { isMissingNotifyColumn } from "../parent/notify-column";
import { isMissingActorColumns } from "../actor-columns";

/**
 * 셔틀 조회 — 읽기는 세션 클라이언트 + RLS(테넌트 전원, 0225a). 쓰기는 서버 액션(actions.ts).
 *
 * ⚠️ 0225a 미적용 배포에서도 죽지 않는다 — `ready:false`로 접는다([[#95]] 마이그레이션보다 앱을
 *    먼저 배포하면 화면이 통째로 죽는 사고. 셔틀은 매일 여는 자리가 아니지만 규약은 같다).
 * ⚠️ 임베드는 FK 이름을 항상 명시한다([[#94]]) — 나중에 누가 컬럼 하나를 더하면 힌트 없는 임베드가
 *    PGRST201(HTTP 300)로 죽고 "총 0건"으로 위장한다.
 */

/** 표가 아직 없을 때 나는 PostgREST 코드(42P01 = undefined_table / PGRST205 = 스키마 캐시에 없음). */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*shuttle_.* does not exist/i.test(error.message ?? "")
  );
}

/**
 * **컬럼이** 아직 없을 때(42703 = undefined_column / PGRST204 = 스키마 캐시에 그 컬럼이 없음).
 * 🔑 표 부재와 코드가 다르다 — 마이그레이션이 표를 만드는 게 아니라 **컬럼을 더하는** 경우
 *    (0244a 좌표)엔 `isMissingTable`로 안 잡혀 그대로 화면이 죽는다([[#95]]).
 */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist/i.test(error.message ?? "")
  );
}

export type ShuttleBoard = {
  ready: boolean;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  stops: ShuttleStop[];
  /**
   * 0244a(좌표 컬럼) 적용 여부. false면 화면이 **좌표 입력 자체를 안 그린다** — 없는 기능을 버튼으로
   * 약속하면 눌렀을 때 한글 에러만 나온다([[#95]], 0229a `exceptionsReady`와 같은 규약).
   */
  coordsReady: boolean;
};

const EMPTY_BOARD = (season: Season): ShuttleBoard => ({
  ready: false,
  season,
  vehicles: [],
  runs: [],
  stops: [],
  coordsReady: false,
});

type StudentRow = { id: string; name: string; school: string | null; grade: string | null; status: string };

/** 배정된 학생들의 표시 정보 — 이름·학교/학년·상태(퇴원생 회색 처리에 쓴다). */
async function loadStudents(ids: string[]): Promise<Map<string, StudentRow>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  // 수십~수백 id — 맨몸 `.in()`은 414 + error 삼킴([[#53]]).
  const rows = await fetchInChunks<StudentRow>(ids, (chunk) =>
    supabase.from("students").select("id, name, school, grade, status").in("id", chunk),
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function toRider(
  row: {
    id: string;
    run_stop_id: string;
    student_id: string;
    io_kind: string;
    weekdays: string[] | null;
    memo: string | null;
  },
  students: Map<string, StudentRow>,
): ShuttleRider | null {
  if (!isDirection(row.io_kind)) return null;
  const s = students.get(row.student_id);
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: s?.name ?? "(삭제된 학생)",
    schoolGrade: s ? schoolGradeLabel(s.school, s.grade) : "",
    ioKind: row.io_kind,
    weekdays: (row.weekdays ?? []) as DayCode[],
    memo: row.memo,
    studentStatus: s?.status ?? "unknown",
  };
}

/**
 * 편성 보드 — 시즌 하나의 차량·회차·노선·배정 전부. 화면(드래그 편집)과 인쇄가 함께 쓴다.
 *
 * 규모는 작다(실측 이관 대상: 차량 3 · 회차 16 · 노선 칸 ~290 · 배정 ~160) — 그래도 id 목록이
 * 수백이라 riders 조회는 청크로 나눈다(B3).
 */
export async function getShuttleBoard(season: Season): Promise<ShuttleBoard> {
  try {
    return await loadShuttleBoard(season);
  } catch (e) {
    // 🔴 `fetchInChunks`는 규약대로 **throw**한다([[#53]]) — 그대로 두면 서버 컴포넌트가 500이 되고
    //    창(iframe)이 통째로 검게 죽어 단서가 0이 된다([[#109]]). 계측만 남기고 빈 보드로 접는다.
    reportError(e, { scope: "shuttle.board", season });
    return EMPTY_BOARD(season);
  }
}

async function loadShuttleBoard(season: Season): Promise<ShuttleBoard> {
  const user = await getCurrentUser();
  if (!user) return EMPTY_BOARD(season);
  const supabase = await createClient();

  // 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [vehiclesRes, stopsRes, runsRes] = await Promise.all([
    supabase
      .from("shuttle_vehicles")
      .select("id, name, driver_name, driver_phone, sort_order")
      .eq("archived", false)
      .order("sort_order")
      .order("name")
      .limit(200),
    supabase
      .from("shuttle_stops")
      .select("id, name, memo, sort_order")
      .eq("archived", false)
      .order("sort_order")
      .order("name")
      .limit(500),
    supabase
      .from("shuttle_runs")
      .select("id, vehicle_id, season, run_no, direction, label")
      .eq("season", season)
      .order("run_no")
      .limit(500),
  ]);

  if (isMissingTable(vehiclesRes.error)) return EMPTY_BOARD(season);
  for (const res of [vehiclesRes, stopsRes, runsRes]) {
    if (res.error) {
      reportError(res.error, { scope: "shuttle.board" });
      return EMPTY_BOARD(season);
    }
  }

  const vehicles: ShuttleVehicle[] = (vehiclesRes.data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    driverName: v.driver_name,
    driverPhone: v.driver_phone,
    sortOrder: v.sort_order,
  }));
  const stopRows = stopsRes.data ?? [];
  const runRows = (runsRes.data ?? []).filter((r) => isSeason(r.season) && isDirection(r.direction));

  const runIds = runRows.map((r) => r.id);
  const runStopRows = await fetchInChunks<{
    id: string;
    run_id: string;
    kind: string;
    stop_id: string | null;
    sort_order: number;
    at_time: string | null;
  }>(runIds, (chunk) =>
    supabase
      .from("shuttle_run_stops")
      .select("id, run_id, kind, stop_id, sort_order, at_time")
      .in("run_id", chunk),
  );

  const runStopIds = runStopRows.map((r) => r.id);
  const riderRows = await fetchInChunks<{
    id: string;
    run_stop_id: string;
    student_id: string;
    io_kind: string;
    weekdays: string[] | null;
    memo: string | null;
  }>(runStopIds, (chunk) =>
    supabase
      .from("shuttle_riders")
      .select("id, run_stop_id, student_id, io_kind, weekdays, memo")
      .in("run_stop_id", chunk),
  );

  // 좌표는 **따로** 받는다 — 위 select에 끼워 넣으면 0244a 미적용 배포에서 보드가 통째로 빈다([[#95]]).
  const [students, coords] = await Promise.all([
    loadStudents([...new Set(riderRows.map((r) => r.student_id))]),
    loadStopCoords(),
  ]);
  const stopById = new Map(stopRows.map((s) => [s.id, s]));

  const ridersByRunStop = new Map<string, ShuttleRider[]>();
  for (const row of riderRows) {
    const rider = toRider(row, students);
    if (!rider) continue;
    const list = ridersByRunStop.get(row.run_stop_id) ?? [];
    list.push(rider);
    ridersByRunStop.set(row.run_stop_id, list);
  }
  for (const list of ridersByRunStop.values()) {
    list.sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }

  const stopsByRun = new Map<string, ShuttleRunStop[]>();
  for (const row of runStopRows) {
    const master = row.stop_id ? stopById.get(row.stop_id) : null;
    const kind = row.kind === "depart" || row.kind === "arrive" ? row.kind : "stop";
    const list = stopsByRun.get(row.run_id) ?? [];
    list.push({
      id: row.id,
      kind,
      stopId: row.stop_id,
      stopName: master?.name ?? (kind === "depart" ? "학원 출발" : kind === "arrive" ? "학원 도착" : "(삭제된 정류장)"),
      stopMemo: master?.memo ?? null,
      sortOrder: row.sort_order,
      atTime: row.at_time ? row.at_time.slice(0, 5) : null,
      riders: ridersByRunStop.get(row.id) ?? [],
    });
    stopsByRun.set(row.run_id, list);
  }
  for (const list of stopsByRun.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  // 정류장이 몇 개 노선에 쓰이는지 — 0이면 안전 삭제 신호(이 시즌 기준).
  const usage = new Map<string, number>();
  for (const row of runStopRows) {
    if (!row.stop_id) continue;
    usage.set(row.stop_id, (usage.get(row.stop_id) ?? 0) + 1);
  }

  const runs: ShuttleRun[] = runRows.map((r) => ({
    id: r.id,
    vehicleId: r.vehicle_id,
    season: r.season as Season,
    runNo: r.run_no,
    direction: r.direction as Direction,
    label: r.label,
    stops: stopsByRun.get(r.id) ?? [],
  }));

  const vehicleOrder = new Map(vehicles.map((v, i) => [v.id, i]));
  runs.sort(
    (a, b) =>
      (vehicleOrder.get(a.vehicleId) ?? 999) - (vehicleOrder.get(b.vehicleId) ?? 999) ||
      a.runNo - b.runNo,
  );

  return {
    ready: true,
    season,
    vehicles,
    runs,
    coordsReady: coords.ready,
    stops: stopRows.map((s) => {
      const c = coords.byStop.get(s.id);
      return {
        id: s.id,
        name: s.name,
        memo: s.memo,
        sortOrder: s.sort_order,
        usedByRuns: usage.get(s.id) ?? 0,
        lat: c?.lat ?? null,
        lng: c?.lng ?? null,
        radiusM: c?.radiusM ?? 50,
        address: c?.address ?? null,
      };
    }),
  };
}

// ── 일별 등하원 ────────────────────────────────────────────────────────────────────────

export type BoardingLog = {
  id: string;
  studentId: string;
  runId: string | null;
  runStopId: string | null;
  stopId: string | null;
  vehicleLabel: string | null;
  stopLabel: string | null;
  runNo: number | null;
  ioKind: Direction;
  status: BoardingStatus;
  memo: string | null;
  /** 찍은 시각(ISO) — 학부모 등하원이 "몇 시에 탔는지"로 읽는다(0225a부터 있던 칸). */
  recordedAt: string | null;
  /** 학부모 탑승 알림 대상인가(0368c) — [전송]=true · [저장]=false. */
  notifyParent: boolean;
};

/**
 * 그날의 등하원 기록 전건. 하루치는 최대 수백 행이라 상한을 명시한다(B2 — 무페이징 select 금지).
 * `run_stop_id`는 표에 없다(회차 삭제 후에도 기록이 남아야 해서) — 예정과의 대조 키는
 * (student, run, io)이고, 화면은 그 조합으로 붙인다.
 */
export async function getBoardingsOn(ymd: string): Promise<{ ready: boolean; logs: BoardingLog[] }> {
  const user = await getCurrentUser();
  if (!user) return { ready: false, logs: [] };
  const supabase = await createClient();
  const first = await supabase
    .from("shuttle_boardings")
    .select("id, student_id, run_id, stop_id, vehicle_label, stop_label, run_no, io_kind, status, memo, recorded_at, notify_parent")
    .eq("boarded_on", ymd)
    .limit(2000);
  // ⚠️ 0368c(notify_parent) 전 DB면 그 칸만 빼고 다시 읽는다 — 안 그러면 찍은 기록이 전부 '미기록'으로 보인다(notify-column.ts).
  //    그때 기록은 전부 알림 대상(notify_parent=true)으로 친다.
  const fallback = isMissingNotifyColumn(first.error)
    ? await supabase
        .from("shuttle_boardings")
        .select("id, student_id, run_id, stop_id, vehicle_label, stop_label, run_no, io_kind, status, memo, recorded_at")
        .eq("boarded_on", ymd)
        .limit(2000)
    : null;
  const error = fallback ? fallback.error : first.error;
  const data = fallback ? (fallback.data ?? []).map((r) => ({ ...r, notify_parent: true })) : first.data;

  if (isMissingTable(error)) return { ready: false, logs: [] };
  if (error) {
    reportError(error, { scope: "shuttle.boardings", ymd });
    return { ready: false, logs: [] };
  }

  const logs: BoardingLog[] = [];
  for (const r of data ?? []) {
    if (!isDirection(r.io_kind) || !isBoardingStatus(r.status)) continue;
    logs.push({
      id: r.id,
      studentId: r.student_id,
      runId: r.run_id,
      runStopId: null,
      stopId: r.stop_id,
      vehicleLabel: r.vehicle_label,
      stopLabel: r.stop_label,
      runNo: r.run_no,
      ioKind: r.io_kind,
      status: r.status,
      memo: r.memo,
      recordedAt: r.recorded_at,
      notifyParent: r.notify_parent !== false,
    });
  }
  return { ready: true, logs };
}

/**
 * 그날의 **일회성 탑승 개입**(0229a) — 오늘만 탐 / 오늘만 안 탐.
 *
 * ⚠️ **0229a 적용 전에도 죽지 않는다**([[#95]]) — 표가 없으면 `ready:false` + 예외 0건으로 조용히
 *    접히고 셔틀 화면은 종전대로 산다(정기 배정만 보인다). 화면은 `ready`로 "쓸 수 있는 기능인지"만
 *    가른다 — 없는 기능을 버튼으로 약속하지 않기 위해서다.
 * ⚠️ 학생 이름은 여기서 붙인다 — `add` 줄은 정기 배정이 없어 **이름의 출처가 이 조회뿐**이다.
 *    (`fetchInChunks`로 나눈다: 하루 예외는 몇 건이지만 규약은 같다, B3.)
 */
export async function getRideExceptionsOn(
  ymd: string,
): Promise<{ ready: boolean; exceptions: RideException[] }> {
  const user = await getCurrentUser();
  if (!user) return { ready: false, exceptions: [] };
  try {
    const supabase = await createClient();
    const first = await supabase
      .from("shuttle_ride_exceptions")
      .select("id, student_id, kind, io_kind, run_stop_id, memo, actor_kind, actor_name")
      .eq("on_date", ymd)
      .limit(500); // 하루 예외는 몇 건 규모 — 절단 방지 명시 상한(B2)
    // 0321a 전 DB면 행위자 칸 없이 다시 읽는다([[#95]] — 안 그러면 그날 변경이 화면에서 통째로 사라진다).
    const fallback = isMissingActorColumns(first.error)
      ? await supabase
          .from("shuttle_ride_exceptions")
          .select("id, student_id, kind, io_kind, run_stop_id, memo")
          .eq("on_date", ymd)
          .limit(500)
      : null;
    const error = fallback ? fallback.error : first.error;
    const data = fallback
      ? (fallback.data ?? []).map((r) => ({ ...r, actor_kind: null as string | null, actor_name: null as string | null }))
      : first.data;

    if (isMissingTable(error)) return { ready: false, exceptions: [] };
    if (error) {
      reportError(error, { scope: "shuttle.rideExceptions", ymd });
      return { ready: false, exceptions: [] };
    }

    const rows = (data ?? []).filter((r) => isDirection(r.io_kind) && isRideExceptionKind(r.kind));
    const students = await loadStudents([...new Set(rows.map((r) => r.student_id))]);
    return {
      ready: true,
      exceptions: rows.map((r) => {
        const s = students.get(r.student_id);
        return {
          id: r.id,
          studentId: r.student_id,
          studentName: s?.name ?? "(삭제된 학생)",
          schoolGrade: s ? schoolGradeLabel(s.school, s.grade) : "",
          studentStatus: s?.status ?? "unknown",
          kind: r.kind as RideExceptionKind,
          ioKind: r.io_kind as Direction,
          runStopId: r.run_stop_id,
          memo: r.memo,
          actorKind: r.actor_kind === "parent" || r.actor_kind === "staff" ? r.actor_kind : null,
          actorName: r.actor_name ?? null,
        };
      }),
    };
  } catch (e) {
    // fetchInChunks는 규약대로 throw한다([[#53]]) — 부가 축이라 화면을 죽이지 않고 접는다.
    reportError(e, { scope: "shuttle.rideExceptions", ymd });
    return { ready: false, exceptions: [] };
  }
}


/** 그날 요일에 해당하는 회차만 추린 목록(일별 화면·인쇄가 함께 쓴다). */
export function dayCodeForDate(ymd: string): DayCode {
  return dayCodeOf(ymd);
}

// ── 운행 단위(0243a) ───────────────────────────────────────────────────────────────────

/**
 * 그날의 **운행 기록**(출발했나/끝났나) — 회차 id로 찾을 수 있게 Map으로 돌려준다.
 *
 * 🔴 `ready`가 중요한 축이다 — 0243a 적용 전에는 표가 없어 **모든 회차가 '출발 전'**으로 보이는데,
 *    그건 사실이 아니라 "모른다"이다. 화면은 `ready:false`면 상태를 **아예 그리지 않는다**([[#95]]) —
 *    실제로 돌고 있는 차를 "출발 전"이라고 말하지 않기 위해서다.
 *
 * ⚠️ 사람 이름은 **임베드가 아니라 별도 조회**로 붙인다. `started_by`·`ended_by`가 둘 다 users를
 *    가리켜 임베드는 FK 힌트가 필수인데([[#94]]), 하루 회차는 실측 30개·사람은 두세 명이라
 *    한 번 더 도는 편이 힌트가 어긋나 화면이 죽는 것보다 낫다.
 */
export async function getTripsOn(
  ymd: string,
): Promise<{ ready: boolean; trips: Map<string, ShuttleTrip> }> {
  const empty = { ready: false, trips: new Map<string, ShuttleTrip>() };
  const user = await getCurrentUser();
  if (!user) return empty;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shuttle_trips")
      .select("id, run_id, started_at, started_by, ended_at, ended_by, memo")
      .eq("ran_on", ymd)
      .limit(500); // 하루 회차는 실측 30개 규모 — 절단 방지 명시 상한(B2)

    if (isMissingTable(error)) return empty;
    if (error) {
      reportError(error, { scope: "shuttle.trips", ymd });
      return empty;
    }

    const rows = data ?? [];
    const names = await loadUserNames([
      ...new Set(rows.flatMap((r) => [r.started_by, r.ended_by]).filter((v): v is string => !!v)),
    ]);

    const trips = new Map<string, ShuttleTrip>();
    for (const r of rows) {
      // 회차가 지워진 옛 운행은 이 화면의 줄이 아니다(회차 id로 찾는 Map이라 자리가 없다).
      if (!r.run_id) continue;
      trips.set(r.run_id, {
        id: r.id,
        runId: r.run_id,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        // 모르면 null — 이름을 지어내지 않는다.
        startedByName: r.started_by ? (names.get(r.started_by) ?? null) : null,
        endedByName: r.ended_by ? (names.get(r.ended_by) ?? null) : null,
        memo: r.memo,
      });
    }
    return { ready: true, trips };
  } catch (e) {
    reportError(e, { scope: "shuttle.trips", ymd });
    return empty;
  }
}

/** 표시용 직원 이름 — 셔틀은 몇 명뿐이지만 규약대로 청크로 나눈다(B3). */
async function loadUserNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const rows = await fetchInChunks<{ id: string; display_name: string }>(ids, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

// ── 정류장 좌표(0244a) ─────────────────────────────────────────────────────────────────

export type StopCoords = { lat: number | null; lng: number | null; radiusM: number; address: string | null };

/**
 * 정류장 좌표 — 🔴 **기존 정류장 select에 컬럼을 끼워 넣지 않고 따로 받는다**([[#95]]).
 *
 * aywa는 SQL을 원장이 손으로 실행하므로 배포와 적용 사이에 **항상 간격**이 있다. `getShuttleBoard`의
 * select에 `lat`을 넣었다가 컬럼이 아직 없으면 PostgREST 400 → 그 함수는 규약대로 빈 보드를 돌려주고
 * → **셔틀 편성 화면이 통째로 빈다**. 좌표는 부가 정보라 그 대가를 치를 이유가 없다: 따로 받고,
 * 실패하면 좌표만 조용히 없는 것으로 둔다.
 *
 * ⚠️ 컬럼 부재는 표 부재와 코드가 다르다(42703 = undefined_column) — `isMissingTable`로는 안 잡힌다.
 */
export async function loadStopCoords(): Promise<{ ready: boolean; byStop: Map<string, StopCoords> }> {
  const empty = { ready: false, byStop: new Map<string, StopCoords>() };
  const user = await getCurrentUser();
  if (!user) return empty;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shuttle_stops")
      .select("id, lat, lng, radius_m, address")
      .eq("archived", false)
      .limit(500);

    // 표가 없거나(0225a 미적용) 컬럼이 없으면(0244a 미적용) 좌표 없이 간다.
    if (isMissingTable(error) || isMissingColumn(error)) return empty;
    if (error) {
      reportError(error, { scope: "shuttle.stopCoords" });
      return empty;
    }

    const byStop = new Map<string, StopCoords>();
    for (const r of data ?? []) {
      byStop.set(r.id, {
        lat: typeof r.lat === "number" ? r.lat : null,
        lng: typeof r.lng === "number" ? r.lng : null,
        radiusM: typeof r.radius_m === "number" ? r.radius_m : 50,
        address: r.address ?? null,
      });
    }
    return { ready: true, byStop };
  } catch (e) {
    reportError(e, { scope: "shuttle.stopCoords" });
    return empty;
  }
}
