/**
 * 셔틀(노랑버스) 타입 — 0225a 표의 앱쪽 표현. 순수 모듈(IO·server-only 없음)이라
 * 서버 컴포넌트와 클라이언트 컴포넌트가 함께 import한다([[#81]] 런타임 상수 누출 방지).
 *
 * 🔴 요일 라벨·순서는 여기서 새로 만들지 않는다 — 정본은 [`DAY_LABEL_KO`/`DAY_ORDER`](../classes/overlap.ts).
 *    (같은 뜻의 맵을 화면마다 복사해 최대 6벌로 갈렸던 전례 = 팔레트 v4 정리, CLAUDE.md.)
 */
import { DAY_ORDER, DAY_LABEL_KO } from "@/features/classes/overlap";

/** DB `day_of_week` enum과 같은 값. */
export type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const SHUTTLE_DAYS = DAY_ORDER as DayCode[];
export const dayLabel = (d: string): string => DAY_LABEL_KO[d] ?? d;

/** 학기중/방학중 — 차량 복제 대신 이 축으로 가른다(원장 2026-08-19). */
export const SEASONS = ["term", "vacation"] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, string> = { term: "학기중", vacation: "방학중" };
export function isSeason(v: unknown): v is Season {
  return typeof v === "string" && (SEASONS as readonly string[]).includes(v);
}

/** 회차 성격. 학생 개인의 승/하차는 rider.ioKind가 따로 정한다(한 회차에 섞일 수 있다). */
export type Direction = "in" | "out";
export const DIRECTION_LABEL: Record<Direction, string> = { in: "등원", out: "하원" };
export function isDirection(v: unknown): v is Direction {
  return v === "in" || v === "out";
}

/** 노선 한 칸의 종류 — 학원 출발/도착은 정류장 마스터에 넣지 않는다(0225a 주석). */
export type RunStopKind = "stop" | "depart" | "arrive";
export const RUN_STOP_KIND_LABEL: Record<RunStopKind, string> = {
  stop: "정류장",
  depart: "학원 출발",
  arrive: "학원 도착",
};

/** 그날 실제 탑승 상태. makeedu의 승차/하차/미탑승 3버튼을 승·하차 × 탑승여부로 정규화한 것. */
export type BoardingStatus = "boarded" | "missed" | "extra";
export const BOARDING_STATUS_LABEL: Record<BoardingStatus, string> = {
  boarded: "탑승",
  missed: "미탑승",
  extra: "추가 탑승",
};
export function isBoardingStatus(v: unknown): v is BoardingStatus {
  return v === "boarded" || v === "missed" || v === "extra";
}

/**
 * 일회성 탑승 개입(0229a) — **그날만의 예정 변경**. 🔴 실제 탑승 기록(`BoardingStatus`)과 다른 축이다:
 * 이건 "탈 예정인가"이고 저건 "탔는가"다. 섞으면 안 탔는데 탄 걸로 남는다(0229a 머리 주석).
 */
export type RideExceptionKind = "skip" | "add";
export const RIDE_EXCEPTION_LABEL: Record<RideExceptionKind, string> = {
  skip: "오늘 안 탐",
  add: "오늘만 탑승",
};
export function isRideExceptionKind(v: unknown): v is RideExceptionKind {
  return v === "skip" || v === "add";
}

export type ShuttleStop = {
  id: string;
  name: string;
  memo: string | null;
  sortOrder: number;
  /** 지금 몇 개 노선이 이 정류장을 쓰는지 — 0이면 안전하게 지울 수 있다는 신호. */
  usedByRuns?: number;
  /**
   * 좌표(0243a) — 🔴 **둘 다 있거나 둘 다 없다**(DB check가 강제). 아직 안 찍은 정류장이 정상이라
   * null이 흔하다. 있는지 판정은 손으로 하지 말고 `hasCoords()`를 쓸 것.
   */
  lat?: number | null;
  lng?: number | null;
  /** 도착 판정 반경(m) — GPS가 붙었을 때 쓰고, 지금은 지도에 원으로만 보인다. 기본 50(0243a). */
  radiusM?: number;
  /** 사람이 읽는 주소 — 좌표는 못 읽으므로 **화면에 보여줄 것은 이 값**이다. */
  address?: string | null;
};

/** 좌표가 실제로 찍혔나 — 한쪽만 있는 값을 "있음"으로 세지 않는다(0243a check와 같은 판정). */
export function hasCoords(
  stop: Pick<ShuttleStop, "lat" | "lng">,
): stop is Pick<ShuttleStop, "lat" | "lng"> & { lat: number; lng: number } {
  return typeof stop.lat === "number" && typeof stop.lng === "number";
}

/**
 * 그날 그 회차의 **운행 단위**(0242a) — 출발했나 / 끝났나.
 *
 * 🔴 진행률(탑승 N/M)은 여기 없다 — 그 사실의 주인은 `shuttle_boardings`다(0242a 머리 주석).
 *    두 곳에 두면 찍을 때마다 맞춰야 하고, 한쪽이 틀어지면 관제 숫자가 조용히 거짓이 된다.
 */
export type ShuttleTrip = {
  id: string;
  runId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** 누가 눌렀나 — 관제에서 "누구한테 전화하지"의 답이 된다. 모르면 null(지어내지 않는다). */
  startedByName: string | null;
  endedByName: string | null;
  memo: string | null;
};

export type ShuttleVehicle = {
  id: string;
  name: string;
  driverName: string | null;
  driverPhone: string | null;
  sortOrder: number;
};

export type ShuttleRider = {
  id: string;
  studentId: string;
  studentName: string;
  /** "경명여중1" 압축 표기(schoolGradeLabel) — 동명이인 구분용. */
  schoolGrade: string;
  ioKind: Direction;
  weekdays: DayCode[];
  memo: string | null;
  /** 재원이 아닌 학생(퇴원·휴원 등)이면 화면이 회색 + 정리 제안을 띄운다. */
  studentStatus: string;
};

export type ShuttleRunStop = {
  id: string;
  kind: RunStopKind;
  stopId: string | null;
  stopName: string;
  stopMemo: string | null;
  sortOrder: number;
  atTime: string | null;
  riders: ShuttleRider[];
};

export type ShuttleRun = {
  id: string;
  vehicleId: string;
  season: Season;
  runNo: number;
  direction: Direction;
  label: string | null;
  stops: ShuttleRunStop[];
};

/** 회차 표시 이름 — 별칭이 있으면 그것, 없으면 "3회차 등원". */
export function runTitle(run: Pick<ShuttleRun, "runNo" | "direction" | "label">): string {
  return run.label?.trim() || `${run.runNo}회차 ${DIRECTION_LABEL[run.direction]}`;
}

/** 회차의 운행 시간대 "13:46~14:11". 시각이 하나도 없으면 빈 문자열. */
export function runTimeRange(stops: readonly Pick<ShuttleRunStop, "atTime">[]): string {
  const times = stops.map((s) => s.atTime).filter((t): t is string => !!t);
  if (times.length === 0) return "";
  const hm = times.map((t) => t.slice(0, 5)).sort();
  const first = hm[0]!;
  const last = hm[hm.length - 1]!;
  return first === last ? first : `${first}~${last}`;
}
