/**
 * 셔틀 **주간 시간표** 격자(순수) — 원장 2026-10-08: 구글 시트 '셔틀버스(차량) 탑승현황'의 '7,8시하원' 탭처럼
 * **회차 하나 = 표 하나**, 줄 = 정류장(노선 순서·시각), 칸 = 요일, 칸 안 = 그날 그 정류장에서 타고/내리는 학생,
 * 맨 아래 = 요일별 인원.
 *
 * 🔑 재료는 편성 보드(`getShuttleBoard`) 그대로 — 새 표·새 조회 없음. 요일은 배정의 `weekdays`(빈 배열 = 매일).
 * 🔑 그날만의 예외(0229a '오늘 안 탐'·'오늘만 승하차')는 **넣지 않는다** — 이 화면은 정규 편성이다(그날 사정은 오늘 등하원 화면).
 * ⚠️ 클라·서버 공용 — `server-only` 금지([[#81]]).
 */
import { SHUTTLE_DAYS, type DayCode, type Direction, type ShuttleRider, type ShuttleRun, type RunStopKind } from "./types";

/** 주말은 그 시즌에 주말 배정이 하나라도 있을 때만 열을 세운다(빈 열 두 개가 표를 좁힌다). */
const WEEKDAYS: readonly DayCode[] = ["mon", "tue", "wed", "thu", "fri"];

export function ridesOnDay(rider: Pick<ShuttleRider, "weekdays">, day: DayCode): boolean {
  return rider.weekdays.length === 0 || rider.weekdays.includes(day);
}

/** 화면에 세울 요일 열 — 평일 다섯 + 배정이 있는 주말. */
export function weekColumns(runs: readonly ShuttleRun[]): DayCode[] {
  const used = new Set<DayCode>();
  for (const run of runs)
    for (const stop of run.stops) for (const r of stop.riders) for (const d of r.weekdays) used.add(d);
  return SHUTTLE_DAYS.filter((d) => WEEKDAYS.includes(d) || used.has(d));
}

export type WeekRider = {
  id: string;
  studentId: string;
  name: string;
  schoolGrade: string;
  /** 회차 방향과 반대로 타는 학생만 표식(등원 회차에서 내리는 학생 등) — 같으면 null(군더더기). */
  crossTag: "승차" | "하차" | null;
  memo: string | null;
  /** 재원이 아니면(퇴원·휴원) 흐리게. */
  inactive: boolean;
};

export type WeekRow = {
  key: string;
  kind: RunStopKind;
  name: string;
  /** "HH:MM" 또는 null. */
  time: string | null;
  cells: Record<DayCode, WeekRider[]>;
};

export type RunWeek = {
  rows: WeekRow[];
  /** 요일별 인원 — 그날 이 회차를 타는 **서로 다른 학생 수**. */
  counts: Record<DayCode, number>;
  /** 요일 무관 배정 학생 수. */
  total: number;
};

const CROSS: Record<Direction, "승차" | "하차"> = { in: "승차", out: "하차" };

export function buildRunWeek(run: ShuttleRun, days: readonly DayCode[], isActive: (status: string) => boolean): RunWeek {
  const empty = () => Object.fromEntries(days.map((d) => [d, [] as WeekRider[]])) as Record<DayCode, WeekRider[]>;
  const perDay = new Map<DayCode, Set<string>>(days.map((d) => [d, new Set<string>()]));
  const everyone = new Set<string>();
  const rows: WeekRow[] = [...run.stops]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stop) => {
      const cells = empty();
      const riders = [...stop.riders].sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
      for (const r of riders) {
        everyone.add(r.studentId);
        const w: WeekRider = {
          id: r.id,
          studentId: r.studentId,
          name: r.studentName,
          schoolGrade: r.schoolGrade,
          crossTag: r.ioKind !== run.direction ? CROSS[r.ioKind] : null,
          memo: r.memo,
          inactive: !isActive(r.studentStatus),
        };
        for (const d of days) {
          if (!ridesOnDay(r, d)) continue;
          cells[d].push(w);
          perDay.get(d)!.add(r.studentId);
        }
      }
      return { key: stop.id, kind: stop.kind, name: stop.stopName, time: stop.atTime ? stop.atTime.slice(0, 5) : null, cells };
    });
  const counts = Object.fromEntries(days.map((d) => [d, perDay.get(d)!.size])) as Record<DayCode, number>;
  return { rows, counts, total: everyone.size };
}

/**
 * 화면용으로 줄을 줄인다 — 보이는 요일 어디에도 학생이 없는 **정류장** 줄은 뺀다(원장 2026-10-08
 * *"스크롤이 너무 많이"*). 출발·도착 줄은 회차의 시작·끝이라 남긴다. 뺀 수는 표 아래 한 줄로 알린다.
 */
export function visibleRows(week: RunWeek, days: readonly DayCode[]): { rows: WeekRow[]; hidden: number } {
  const rows = week.rows.filter((r) => r.kind !== "stop" || days.some((d) => r.cells[d].length > 0));
  return { rows, hidden: week.rows.length - rows.length };
}
