/**
 * 학부모 등하원 — **"오늘 우리 아이 셔틀이 어떻게 됐나"를 한 줄로** 만드는 순수 모듈(IO 없음, Vitest).
 *
 * 관리자 뷰(`/shuttle/parent-rides`)와 학부모 뷰(`/parent`)가 **같은 함수**로 같은 문장을 만든다 —
 * 관리자가 "학부모에게 이렇게 보인다"고 확인한 문장과 실제로 학부모가 보는 문장이 갈리면 안 된다.
 *
 * 🔑 재료는 오늘 등하원과 같다(roster.ts): 예정(요일 배정 − 오늘 안 탐 + 오늘만 탐) × 실제 기록
 *    (`shuttle_boardings`) × 운행 상태(`shuttle_trips`). 새 사실을 만들지 않고 **읽는 법만** 바꾼다.
 * 🔴 **기록이 없는 줄은 '미탑승'이 아니다** — 운행 전이면 '예정', 운행 중이면 '운행 중', 운행이
 *    끝났는데도 없을 때만 '기록 없음'이라고 말한다(roster.mergePlanAndLog 주석과 같은 규약).
 * 🔴 **학부모 문장엔 직원 메모를 싣지 않는다** — 메모는 직원끼리 쓰는 말이라(예: "어머니가 직접 데리러
 *    옴") 관리자 뷰에만 보인다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import { addDays, kstTimeOf, weekdayIndexOf } from "@/lib/date-kst";
import { mergePlanAndLog, plannedRidesOn, type BoardingLogLike, type RideException } from "./roster";
import { tripState, type TripState } from "./trip-state";
import {
  SHUTTLE_DAYS,
  runShortTitle,
  type BoardingStatus,
  type DayCode,
  type Direction,
  type RunStopKind,
  type ShuttleRun,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "./types";

/** 학부모 뷰 요일 칩 = 운영일(월~금). 주말은 셔틀을 운영하지 않는다(사용자 2026-09-26). */
const OPERATING_DAYS = SHUTTLE_DAYS.slice(0, 5);

/**
 * 운영 주(월~금) 요일별 날짜 — 학부모 뷰의 요일 칩.
 * 🔑 주말(토·일)에 열면 **다음 주** 월~금을 보여준다 — 지난 평일을 보여 주면 이미 지나간 일정이라 쓸모가 없다.
 * 날짜는 요일 규칙(`weekdays`)을 거는 데만 쓴다 — 오늘이 아닌 요일은 **정기 일정**으로만 보여준다.
 */
export function weekDates(today: string): { day: DayCode; ymd: string }[] {
  const dow = weekdayIndexOf(today); // 0=일 … 6=토
  const monday = dow === 0 ? addDays(today, 1) : dow === 6 ? addDays(today, 2) : addDays(today, -(dow - 1));
  return OPERATING_DAYS.map((day, i) => ({ day, ymd: addDays(monday, i) }));
}

/** 노선 한 칸 — 그 회차의 정류장 전부(학원 출발·도착 포함), 우리 아이 칸 표시. */
export type RouteStop = { id: string; kind: RunStopKind; name: string; time: string | null; mine: boolean };

/** 기록 한 건 — 오늘 등하원 조회 결과에 **찍은 시각**만 더한 모양. */
export type RideLogInput = BoardingLogLike & {
  recordedAt?: string | null;
  /** 학부모 탑승 알림 대상인가(0368c) — [저장]으로 찍으면 false. 없으면 대상. */
  notifyParent?: boolean;
};

export type RideLegInput = {
  ymd: string;
  runs: readonly ShuttleRun[];
  vehicles: readonly Pick<ShuttleVehicle, "id" | "name">[];
  exceptions: readonly RideException[];
  logs: readonly RideLogInput[];
  trips: ReadonlyMap<string, ShuttleTrip>;
  /** 운행 표(0243a)가 준비됐나 — false면 운행 상태를 **모름**으로 둔다(출발 전이라고 말하지 않는다). */
  tripsReady: boolean;
};

/** 오늘 한 학생의 셔틀 한 구간(등원 또는 하원). */
export type RideLeg = {
  key: string;
  studentId: string;
  direction: Direction;
  vehicleId: string;
  runId: string;
  vehicleName: string;
  runName: string;
  stopName: string;
  /** 노선에 적힌 예정 시각 "HH:MM". */
  plannedTime: string | null;
  /** 오늘만 안 탐(0229a). */
  skipped: boolean;
  /** 오늘만 탐(0229a). */
  added: boolean;
  status: BoardingStatus | null;
  /** 찍은 시각 "HH:MM"(KST). */
  recordedTime: string | null;
  /** 운행 상태 — 표가 없으면 null(모름). */
  trip: TripState | null;
  /** 이 기록이 학부모 탑승 알림 대상인가(0368c) — 셔틀 [저장]으로 찍었으면 false. 기록이 없으면 true. */
  notifyParent: boolean;
  /** 운행 출발 시각 "HH:MM" — 학부모 출발 알림(0368a)이 쓴다. */
  tripStartedTime: string | null;
  /** 운행 종료 시각 "HH:MM" — 등원이면 학원 도착 시각이다. */
  tripEndedTime: string | null;
  /** 직원 메모(기록 메모 → 오늘만 변경 사유). 🔴 관리자 뷰 전용. */
  staffMemo: string | null;
  /**
   * 그 회차의 노선 전체(정류장 순서). 🔑 **다른 아이 정보는 없다** — 정류장 이름·시각뿐이고,
   * `mine`이 우리 아이가 타고 내리는 칸이다(예정 없는 추가 탑승이면 전부 false).
   */
  route: RouteStop[];
};

/** 오늘 셔틀 구간 전부 — 학생 id → 구간(예정 시각 순). */
export function buildRideLegs(input: RideLegInput): Map<string, RideLeg[]> {
  const vehicleName = new Map(input.vehicles.map((v) => [v.id, v.name]));
  const recordedAt = new Map(input.logs.map((l) => [l.id, l.recordedAt ?? null]));
  const notifyOf = new Map(input.logs.map((l) => [l.id, l.notifyParent !== false]));
  const out = new Map<string, RideLeg[]>();

  for (const run of input.runs) {
    const planned = plannedRidesOn(run, input.ymd, input.exceptions);
    const logs = input.logs.filter((l) => l.runId === run.id);
    const trip = input.trips.get(run.id) ?? null;
    const stops = [...run.stops].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const row of mergePlanAndLog(planned, logs)) {
      // '오늘만 승하차'로 대체된 평소 줄은 학부모 문장에서 뺀다 — 그날 그 방향은 대체한 줄이 말한다.
      // 🔑 단 그 줄에 **실제로 탔다는 기록**이 있으면 남긴다(다른 차에서 찍힌 사실을 숨기지 않는다).
      if (row.dayKind === "replaced" && row.status !== "boarded" && row.status !== "extra") continue;
      // 예정에 없는 기록 줄(runStopId 없음)도 **실제로 탔을 때만** 남긴다 — 고정시간을 다른 회차로 옮기면
      // 옛 회차에 찍힌 '미탑승'이 떨어져 나와 같은 방향 구간이 두 개로 보였다(사용자 2026-09-29).
      if (row.runStopId === null && row.status !== "boarded" && row.status !== "extra") continue;
      // 예정 없는 기록 줄은 기록의 정류장 이름으로 노선 칸을 되짚는다 — 안 그러면 시각이 비어 맨 뒤로 밀리고
      // 노선에 '여기서 타요'도 안 선다(사용자 2026-09-30 "등원이 밑으로 밀리고 내역도 없다").
      // 🔑 이름이 **정확히 한 칸**과 맞을 때만(같은 이름이 둘이면 어느 칸인지 지어내지 않는다).
      const named = row.runStopId === null ? stops.filter((s) => s.kind === "stop" && s.stopName === row.stopName) : [];
      const matched = named.length === 1 ? named[0]! : null;
      const mineId = row.runStopId ?? matched?.id ?? null;
      const leg: RideLeg = {
        key: `${run.id}|${row.key}`,
        studentId: row.studentId,
        direction: row.ioKind,
        vehicleId: run.vehicleId,
        runId: run.id,
        vehicleName: vehicleName.get(run.vehicleId) ?? "",
        runName: runShortTitle(run),
        stopName: row.stopName,
        plannedTime: row.atTime ?? matched?.atTime ?? null,
        skipped: row.dayKind === "skipped",
        added: row.dayKind === "added",
        status: row.status,
        recordedTime: row.logId ? kstTimeOf(recordedAt.get(row.logId)) : null,
        notifyParent: row.logId ? (notifyOf.get(row.logId) ?? true) : true,
        trip: input.tripsReady ? tripState(trip) : null,
        tripStartedTime: input.tripsReady ? kstTimeOf(trip?.startedAt) : null,
        tripEndedTime: kstTimeOf(trip?.endedAt),
        staffMemo: row.memo ?? row.exceptionMemo,
        route: stops.map((s) => ({ id: s.id, kind: s.kind, name: s.stopName, time: s.atTime, mine: s.id === mineId })),
      };
      const list = out.get(leg.studentId) ?? [];
      list.push(leg);
      out.set(leg.studentId, list);
    }
  }
  for (const [studentId, list] of out) {
    // 등원 먼저, 그 안에서 시각 순 — 등원을 저녁 회차로 옮긴 날에도 등원이 하원 아래로 내려가지 않는다.
    list.sort((a, b) =>
      a.direction !== b.direction
        ? (a.direction === "in" ? -1 : 1)
        : (a.plannedTime ?? "99:99").localeCompare(b.plannedTime ?? "99:99"));
    out.set(studentId, oneLegPerRide(list));
  }
  return out;
}

/**
 * 그 구간에 **실제로 탔다**(탑승·추가 탑승 기록). 🔑 탄 구간은 학부모가 고칠 수 없다(사용자 2026-09-30) —
 * 카드는 노선을 흐리게 잠그고 수정·타지 않기 버튼을 세우지 않는다. 서버(parent-ride-actions.ts)도 같은 기록으로 막는다.
 * '미탑승'은 탄 게 아니라 고칠 수 있다(차가 지나갔어도 열린 다른 회차로 옮긴다).
 */
export const legRode = (leg: Pick<RideLeg, "status">) => leg.status === "boarded" || leg.status === "extra";
const rode = legRode;

/**
 * 한 방향엔 한 번만 탄다 — **실제로 탄 구간이 있으면 같은 방향의 나머지는 뺀다**(사용자 2026-09-30).
 * 오늘 1회차로 이미 등원했는데 등원 고정시간을 2회차로 옮기면, 새 고정이 오늘 명단에도 먹어서
 * '1회차 탔음' + '2회차 예정' 두 등원 구간이 섰다. 사실(탄 기록)이 계획을 이긴다.
 * 🔑 탄 구간끼리는 둘 다 남긴다(정말 두 번 찍혔다면 그것도 사실이다).
 */
function oneLegPerRide(list: RideLeg[]): RideLeg[] {
  const rodeDirections = new Set(list.filter(rode).map((l) => l.direction));
  return list.filter((l) => rode(l) || !rodeDirections.has(l.direction));
}

/** 한 호차의 회차 하나 — 학부모 '수정하기' 모달의 노선 한 덩어리. 정류장 이름·시각뿐(다른 아이 정보 없음). */
export type VehicleRoute = {
  runId: string;
  runName: string;
  /** 회차 시작 시각 = '학원 출발' 칸의 시각 "HH:MM". 비어 있으면 null(지어내지 않는다). */
  departTime: string | null;
  stops: Omit<RouteStop, "mine">[];
};

/**
 * 그날 그 방향의 변경 한 건 — 이력 장부(0321a)에서 온다. 🔑 전/후는 저장 당시 **글자 스냅샷**(null = 평소대로).
 * 학부모에게도 **학원이 바꾼 것**까지 보인다(누가 바꿨는지 알아야 "왜 바뀌었지"가 풀린다).
 */
export type RideChange = {
  id: string;
  direction: Direction;
  op: "create" | "update" | "cancel";
  beforeLabel: string | null;
  afterLabel: string | null;
  /** 사유('타지 않기'에서 학부모가 적은 것 등). */
  memo: string | null;
  actorName: string;
  /** "9/29 10:12"(KST). */
  at: string;
};

/** 고정(정기) 시간 변경 한 건 — 0322a 장부. 🔴 직원 화면 전용. */
export type RegularChange = {
  id: string;
  direction: Direction;
  weekday: DayCode;
  beforeLabel: string | null;
  afterLabel: string | null;
  reason: string | null;
  actorName: string;
  /** "9/29 10:12"(KST). */
  at: string;
};

/** 그 요일의 **고정(정기) 자리** 하나 — 아이·방향·노선 칸. 학부모 '고정시간 변경하기' 창이 "지금 고정 시간"으로 보인다. */
export type RegularStop = { studentId: string; direction: Direction; runStopId: string };

/** 학부모 '수정하기' 모달의 호차 하나 — 전환 버튼 순서(차량 정렬순) 그대로. */
export type VehicleFleet = { id: string; name: string; routes: VehicleRoute[] };

/**
 * 호차별 전체 노선 — 차량 id → 그 차의 회차들(학원 출발 시각 순, 시각 없는 회차는 뒤로).
 * 🔑 회차에는 요일이 없다(요일 규칙은 배정에만 있다) — 그래서 그 차의 회차 전부가 곧 그날의 전체 노선이다.
 */
export function buildVehicleRoutes(runs: readonly ShuttleRun[]): Map<string, VehicleRoute[]> {
  const out = new Map<string, VehicleRoute[]>();
  for (const run of runs) {
    const stops = [...run.stops]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, kind: s.kind, name: s.stopName, time: s.atTime }));
    const departTime = stops.find((s) => s.kind === "depart")?.time ?? null;
    const list = out.get(run.vehicleId) ?? [];
    list.push({ runId: run.id, runName: runShortTitle(run), departTime, stops });
    out.set(run.vehicleId, list);
  }
  const start = (r: VehicleRoute) => r.departTime ?? r.stops.find((s) => s.time)?.time ?? "99:99";
  for (const list of out.values()) list.sort((a, b) => start(a).localeCompare(start(b)));
  return out;
}

/** 학부모는 **회차 출발 몇 분 전까지** 바꿀 수 있나(사용자 2026-09-29 "각 회차 시작 10분 전에는 수정을 못하게"). */
export const EDIT_CUTOFF_MINUTES = 10;

/** 회차 시작 시각 = '학원 출발' 칸 시각, 없으면 노선의 첫 시각. 둘 다 없으면 null(모름). */
export function runStartTime(stops: readonly { kind: RunStopKind; time: string | null }[]): string | null {
  return stops.find((s) => s.kind === "depart")?.time ?? stops.find((s) => s.time)?.time ?? null;
}

/**
 * 이 회차가 그날 **수정 마감**인가 — 화면(안내)과 서버(판정)가 같은 함수를 쓴다.
 * · 지난 날짜 = 마감 · 앞으로의 날짜 = 열림
 * · 오늘 = 지금(KST 분)이 **시작 − 10분** 이상이면 마감
 * 🔑 시작 시각을 모르는 회차는 막지 않는다 — 없는 시각으로 마감을 지어내지 않는다.
 */
export function runEditClosed(start: string | null, onDate: string, today: string, nowMinutes: number): boolean {
  if (onDate < today) return true;
  if (onDate > today || !start) return false;
  const [h, m] = start.split(":").map(Number);
  return nowMinutes >= (h ?? 0) * 60 + (m ?? 0) - EDIT_CUTOFF_MINUTES;
}

/** 그날 **모든 회차의 마지막 시각**(가장 늦은 칸 시각) — 이 시각이 지나면 그날 운행이 다 끝났다. 시각이 없으면 null. */
export function dayRunsEndTime(routes: readonly { stops: readonly { time: string | null }[] }[]): string | null {
  let end: string | null = null;
  for (const r of routes) for (const s of r.stops) if (s.time && (!end || s.time > end)) end = s.time;
  return end;
}

/**
 * **고정 시간 변경**에서 이 회차를 고를 수 없나(사용자 2026-09-30 "지난 시간은 셀렉 못 하게 … 모든 운행이 끝나면 다시").
 * · 그 요일의 가장 가까운 날이 오늘이 아니면 늘 열림
 * · 오늘 = 출발 10분 전부터 닫힘(`runEditClosed`와 같은 규칙) — 오늘 명단에 바로 먹어서, 떠난 차로 옮기면 어긋난다
 * · 단 오늘 **모든 회차가 끝났으면**(`dayEnd` 이후) 다시 전부 열림 — 이젠 다음 주부터 적용된다
 * 🔑 시각을 모르면 막지 않는다(지어내지 않음) — 화면(안내)과 서버(판정)가 같은 함수를 쓴다.
 */
export function regularRunClosed(
  start: string | null,
  dayEnd: string | null,
  onDate: string,
  today: string,
  nowMinutes: number,
): boolean {
  if (onDate !== today) return false;
  if (dayEnd) {
    const [h, m] = dayEnd.split(":").map(Number);
    if (nowMinutes >= (h ?? 0) * 60 + (m ?? 0)) return false;
  }
  return runEditClosed(start, onDate, today, nowMinutes);
}

/** 등원·하원 짝 판정의 한쪽 — 회차와 그 정류장 시각("HH:MM", 모르면 null). */
export type RidePoint = { runId: string; time: string | null };

/**
 * 등원·하원 **짝 규칙**(사용자 2026-09-30) — 어기면 안내 문구, 아니면 null. 화면(고르기 잠금)과 서버가 같은 함수.
 * · 같은 회차에 등원과 하원이 함께 있을 수 없다(하원 타임이 있는 회차는 등원으로 못 고른다, 반대도)
 * · 등원 시각은 하원 시각보다 빨라야 한다(같은 시각도 안 된다)
 * 🔑 상대 방향이 없거나(안 타는 날·배정 없음) 시각을 모르면 시각 비교는 하지 않는다(모르는 것으로 막지 않는다).
 */
export function ridePairConflict(direction: Direction, pick: RidePoint, other: RidePoint | null): string | null {
  if (!other) return null;
  if (pick.runId === other.runId) return "등원과 하원은 같은 회차에 탈 수 없어요";
  if (!pick.time || !other.time) return null;
  const inTime = direction === "in" ? pick.time : other.time;
  const outTime = direction === "in" ? other.time : pick.time;
  if (inTime < outTime) return null;
  return direction === "in"
    ? `등원 시간은 하원 시간(${outTime})보다 빨라야 해요`
    : `하원 시간은 등원 시간(${inTime})보다 늦어야 해요`;
}

export type ParentLegView ={ tone: SemanticTone; headline: string; detail: string | null };

const at = (time: string | null, place: string) => [time, place].filter(Boolean).join(" ");

/** 학부모에게 보이는 한 줄 — 관리자 뷰의 미리보기도 이 함수를 쓴다. */
/** 안 타는 구간('타지 않기'·결석) 문구 — 사용자 지정(2026-09-29). 카드와 수정 모달이 같은 말을 쓴다. */
export const SKIPPED_HEADLINE: Record<Direction, string> = {
  in: "등원차를 타지 않습니다",
  out: "하원차를 탑승하지 않습니다",
};

/**
 * @param opts.past 지난 날짜를 보는 중인가(요일별 화면의 지난 요일, 사용자 2026-10-02 *"지난 날은 데이터가 그대로 남게"*) —
 *   기록(몇 시에 탔는지)은 그대로 보이고, "오늘"·"예정"처럼 그날이 아니면 틀린 말만 바꾼다.
 */
export function parentLegView(leg: RideLeg, opts: { past?: boolean } = {}): ParentLegView {
  const past = opts.past === true;
  const ride = leg.direction === "in" ? "탈" : "내릴";
  // 사유는 직원 메모라 학부모 문장엔 싣지 않는다.
  if (leg.skipped) return { tone: "inert", headline: SKIPPED_HEADLINE[leg.direction], detail: null };

  if (leg.status === "boarded" || leg.status === "extra") {
    if (leg.direction === "out") {
      return { tone: "positive", headline: `${at(leg.recordedTime, leg.stopName)}에서 내렸어요`, detail: null };
    }
    const detail =
      leg.trip === "done"
        ? `${leg.tripEndedTime ? `${leg.tripEndedTime} ` : ""}학원에 도착했어요`
        : leg.trip === "running"
          ? "학원으로 가고 있어요"
          : null;
    return { tone: "positive", headline: `${at(leg.recordedTime, leg.stopName)}에서 탔어요`, detail };
  }

  if (leg.status === "missed") {
    return {
      tone: "caution",
      headline: `${past ? "" : "오늘 "}${leg.direction === "in" ? "등원" : "하원"} 셔틀을 타지 않았어요`,
      detail: "궁금한 점은 학원으로 연락해 주세요",
    };
  }

  // 기록 없음 — 운행 상태로 뜻이 갈린다.
  if (leg.trip === "running") {
    return { tone: "info", headline: "셔틀이 운행 중이에요", detail: `${at(leg.plannedTime, leg.stopName)}에서 ${ride} 예정` };
  }
  if (leg.trip === "done") {
    return { tone: "caution", headline: "탑승 기록이 없어요", detail: "궁금한 점은 학원으로 연락해 주세요" };
  }
  // 지난 날인데 기록도 운행 기록도 없다 — "예정"이라 하면 거짓이다.
  if (past) return { tone: "inert", headline: "탑승 기록이 없어요", detail: `${at(leg.plannedTime, leg.stopName)} 일정이었어요` };
  return { tone: "inert", headline: `${at(leg.plannedTime, leg.stopName)}에서 ${ride} 예정이에요`, detail: null };
}
