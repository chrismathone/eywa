/**
 * 셔틀 명단 계산 — **순수 함수**(IO 없음, Vitest). "그날 누가 타는가"는 화면·인쇄·출결 신호가
 * 모두 같은 답을 내야 하므로 여기 한 곳에서만 만든다.
 *
 * 🔑 정기 배정(shuttle_riders.weekdays)은 **요일 규칙**이고, 그날 실제 탑승(shuttle_boardings)은
 *    **기록**이다. 둘을 겹쳐 "예정 vs 실제"를 만드는 게 이 모듈의 일이다.
 */
import { weekdayIndexOf } from "@/lib/date-kst";
import {
  SHUTTLE_DAYS,
  dayLabel,
  type BoardingStatus,
  type DayCode,
  type Direction,
  type ShuttleRun,
  type ShuttleRider,
} from "./types";

/** 0=일 … 6=토 → DayCode. SHUTTLE_DAYS는 월~일 순서라 인덱스를 직접 쓰면 안 된다. */
const BY_INDEX: DayCode[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** YYYY-MM-DD → 요일 코드. UTC 파싱이라 서버 TZ 무관(date-kst 규약 승계). */
export function dayCodeOf(ymd: string): DayCode {
  return BY_INDEX[weekdayIndexOf(ymd)]!;
}

/**
 * 요일 압축 표기 — `["mon","wed","thu"]` → `"월수목"`. makeedu 표기와 같은 모양이라
 * 이관 뒤에도 눈이 익다. 월~일 고정 순서로 정렬해 입력 순서에 흔들리지 않는다.
 * 7개 전부면 `"매일"`, 월~금 전부(주말 없음)면 `"평일"`로 줄인다(가장 흔한 두 경우).
 */
export function compactWeekdays(days: readonly string[]): string {
  const set = new Set(days);
  const ordered = SHUTTLE_DAYS.filter((d) => set.has(d));
  if (ordered.length === 0) return "";
  if (ordered.length === 7) return "매일";
  const weekdaysOnly = ["mon", "tue", "wed", "thu", "fri"];
  if (ordered.length === 5 && weekdaysOnly.every((d) => set.has(d))) return "평일";
  return ordered.map(dayLabel).join("");
}

/** 그 배정이 이 날짜에 해당하는가 — 요일 규칙만 본다(휴일·결석은 상위가 판단). */
export function ridesOn(rider: Pick<ShuttleRider, "weekdays">, ymd: string): boolean {
  return rider.weekdays.includes(dayCodeOf(ymd));
}

/** 그날 그 회차에서 타기로 되어 있는 사람들(정류장 순서 → 이름 순). */
export type PlannedRide = {
  runId: string;
  runNo: number;
  runStopId: string;
  stopName: string;
  atTime: string | null;
  rider: ShuttleRider;
};

export function plannedRidesOn(run: ShuttleRun, ymd: string): PlannedRide[] {
  const out: PlannedRide[] = [];
  for (const stop of [...run.stops].sort((a, b) => a.sortOrder - b.sortOrder)) {
    for (const rider of stop.riders) {
      if (!ridesOn(rider, ymd)) continue;
      out.push({
        runId: run.id,
        runNo: run.runNo,
        runStopId: stop.id,
        stopName: stop.stopName,
        atTime: stop.atTime,
        rider,
      });
    }
  }
  return out;
}

/**
 * 예정 × 기록 대조 — 일별 화면과 출결 신호가 함께 쓴다.
 *
 * ⚠️ 기록이 없는 예정은 `null`(아직 안 찍음)이지 미탑승이 **아니다**. 안 찍힌 걸 미탑승으로 읽으면
 *    아침 내내 전원이 미탑승으로 보이고, 그 상태가 출결 신호로 새어나간다.
 */
export type RideRow = {
  key: string;
  runId: string;
  /** 예정에 없던 추가 탑승이면 null(그날만 태운 학생이라 노선 칸이 없다). */
  runStopId: string | null;
  studentId: string;
  studentName: string;
  stopName: string;
  atTime: string | null;
  ioKind: Direction;
  /** 기록이 아직 없으면 null. */
  status: BoardingStatus | null;
  memo: string | null;
  /** 이미 찍힌 기록의 id — 지우기(clearBoarding)에 쓴다. */
  logId: string | null;
};

/**
 * 🔑 대조 키는 **(학생, 회차, 승/하차)** — 노선 칸(run_stop)이 아니다.
 *    `shuttle_boardings`의 유니크 인덱스가 그 축이고, 그래야 정류장을 옮겨도 그날 기록이 붙어 있다
 *    (칸 축으로 맞추면 노선을 고친 순간 그날 찍은 기록이 통째로 "추가 탑승"으로 떨어져 나간다).
 */
export type BoardingLogLike = {
  id: string;
  studentId: string;
  runId: string | null;
  ioKind: Direction;
  status: BoardingStatus;
  memo: string | null;
  stopLabel?: string | null;
};

export function mergePlanAndLog(
  planned: readonly PlannedRide[],
  logs: readonly BoardingLogLike[],
): RideRow[] {
  const key = (studentId: string, runId: string | null, io: Direction) =>
    `${studentId}|${runId ?? ""}|${io}`;
  const byKey = new Map(logs.map((l) => [key(l.studentId, l.runId, l.ioKind), l]));

  const rows: RideRow[] = planned.map((p) => {
    const k = key(p.rider.studentId, p.runId, p.rider.ioKind);
    const hit = byKey.get(k);
    byKey.delete(k);
    return {
      key: k,
      runId: p.runId,
      runStopId: p.runStopId,
      studentId: p.rider.studentId,
      studentName: p.rider.studentName,
      stopName: p.stopName,
      atTime: p.atTime,
      ioKind: p.rider.ioKind,
      status: hit?.status ?? null,
      memo: hit?.memo ?? null,
      logId: hit?.id ?? null,
    };
  });

  // 예정에 없는데 기록이 있는 것 = 추가 탑승(그날만 태운 학생). 반드시 남긴다 — 안 그리면 실제로
  // 태운 아이가 명단에서 사라진다.
  for (const leftover of byKey.values()) {
    if (!leftover.runId) continue; // 회차가 지워진 옛 기록 — 이 회차 화면의 줄이 아니다
    rows.push({
      key: key(leftover.studentId, leftover.runId, leftover.ioKind),
      runId: leftover.runId,
      runStopId: null,
      studentId: leftover.studentId,
      studentName: "",
      stopName: leftover.stopLabel ?? "",
      atTime: null,
      ioKind: leftover.ioKind,
      status: leftover.status,
      memo: leftover.memo,
      logId: leftover.id,
    });
  }
  return rows;
}

/**
 * 출결 연동 신호 — 🔴 **신호만, 자동 쓰기 없음**(원장 2026-08-19).
 * 그날 셔틀에서 미탑승으로 찍힌 학생만 돌려준다. 출결 화면은 이걸 배지로 보여줄 뿐,
 * 결석을 만들지 않는다(강사 소급 퇴원 사고 이후 자동 쓰기는 사람 판단 뒤로).
 */
export type ShuttleSignal = {
  studentId: string;
  /** "1호차 3회차 등원" 같은 사람이 읽는 문구 — 화면이 그대로 쓴다(raw 코드 노출 금지). */
  where: string;
  reason: string | null;
};

export function missedSignals(
  logs: readonly {
    studentId: string;
    status: BoardingStatus;
    memo: string | null;
    vehicleLabel: string | null;
    runNo: number | null;
    ioKind: Direction;
  }[],
): ShuttleSignal[] {
  const seen = new Set<string>();
  const out: ShuttleSignal[] = [];
  for (const l of logs) {
    if (l.status !== "missed") continue;
    if (seen.has(l.studentId)) continue; // 한 학생당 한 줄이면 충분(첫 미탑승)
    seen.add(l.studentId);
    const parts = [l.vehicleLabel, l.runNo ? `${l.runNo}회차` : null, l.ioKind === "in" ? "등원" : "하원"];
    out.push({
      studentId: l.studentId,
      where: parts.filter(Boolean).join(" ") || "셔틀",
      reason: l.memo?.trim() || null,
    });
  }
  return out;
}
