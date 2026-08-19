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

export type ShuttleStop = {
  id: string;
  name: string;
  memo: string | null;
  sortOrder: number;
  /** 지금 몇 개 노선이 이 정류장을 쓰는지 — 0이면 안전하게 지울 수 있다는 신호. */
  usedByRuns?: number;
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
