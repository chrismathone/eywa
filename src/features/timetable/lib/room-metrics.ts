// 교실뷰 활성도 지표 — 운영 창(교시 설정) 대비 점유율·요일별/주간 매트릭스·요약.
// 순수 모듈(클라/서버 공용, Vitest room-metrics.test.ts). 교시 시각은 학원설정
// (operations.weekdayPeriods/weekendPeriods + 과목별 override) 단일 소스 — 하드코딩 금지.

import type { DayOfWeek, PeriodsConfig } from "./periods";
import { subjectWeekdayPeriods, subjectWeekendPeriods } from "./periods";
import { timeToMin } from "./ten-minute-grid";
import {
  annotateOverlaps,
  classIntervalsExact,
  occupiedMinutes,
  type RoomBucket,
  type RoomInterval,
  type RoomSlotLite,
} from "./room-grid";

export const ROOM_DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];

/** 하루 운영 창(자정 기준 분). null = 그 요일 운영 없음(교시 미설정 + 수업도 없음). */
export type DayWindow = { startMin: number; endMin: number };
export type DayWindows = Record<DayOfWeek, DayWindow | null>;

/**
 * 요일별 운영 창 — 평일 = 데이터에 있는 **모든 과목**의 교시표 합집합(수학 14:30~ ∪ 영어 14:20~ 등),
 * 주말 = 전역 weekend 교시표. 여기에 **관측 확장**: 실제 수업이 창 밖(아침 특강 등)에 있으면 그 요일
 * 창을 관측 범위까지 넓힌다 — 안 하면 가동률이 100%를 넘거나(분모 거짓) 창 없는 요일 수업이 지표에서
 * 증발한다. 수업이 있는데 교시 설정이 아예 없으면 관측 범위만으로 창을 만든다.
 */
export function resolveDayWindows(
  subjectKeys: readonly string[],
  config: PeriodsConfig,
  slots: readonly RoomSlotLite[],
): DayWindows {
  const span = (rows: { startTime: string; endTime: string }[]): DayWindow | null => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      const a = timeToMin(r.startTime);
      const b = timeToMin(r.endTime);
      if (a != null) lo = Math.min(lo, a);
      if (b != null) hi = Math.max(hi, b);
    }
    return hi > lo ? { startMin: lo, endMin: hi } : null;
  };
  const weekday = span((subjectKeys.length ? subjectKeys : [""]).flatMap((k) => subjectWeekdayPeriods(k, config)));
  const weekend = span(subjectWeekendPeriods(config));
  const out: DayWindows = {
    mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday,
    sat: weekend, sun: weekend,
  };
  // 관측 확장 — 요일별 실제 수업 범위와 합집합.
  for (const day of ROOM_DAY_ORDER) {
    const daySlots = slots.filter((s) => s.dayOfWeek === day);
    if (daySlots.length === 0) continue;
    const observed = span(daySlots);
    if (!observed) continue;
    const base = out[day];
    out[day] = base
      ? { startMin: Math.min(base.startMin, observed.startMin), endMin: Math.max(base.endMin, observed.endMin) }
      : observed;
  }
  return out;
}

/** 점유분/창 → 정수 % (창 없으면 null — 0%로 속이지 않는다). */
export function utilPct(occupiedMin: number, window: DayWindow | null): number | null {
  if (!window || window.endMin <= window.startMin) return null;
  return Math.round((occupiedMin / (window.endMin - window.startMin)) * 100);
}

export type RoomDayMetric = {
  occupiedMin: number;
  utilPct: number | null;
  /** 그 요일 점유 구간(반 병합) 수. */
  sessions: number;
  /** 연인원 = Σ 구간 재원 수(반 단위). */
  students: number;
  conflictPairs: number;
};

export type RoomWeekRow = {
  key: string;
  name: string;
  capacity: number | null;
  registered: boolean;
  days: Record<DayOfWeek, RoomDayMetric>;
  /** 주중(월~금) 가동률 — 분모=평일 창 합. 주말 창은 요일 셀로만 본다(일요일 1실 사용이 전 교실 지표를 끌어내리는 왜곡 방지). */
  weekdayUtilPct: number | null;
  weekOccupiedMin: number;
  /** 주간 최대 동시 재원 수(한 구간 기준) — 정원 대비 좌석 압박 판단. */
  maxStudents: number;
  /** 정원 설정이 있고 어느 구간이 정원을 넘었는지. */
  seatOver: boolean;
};

/** 버킷의 요일별 구간(겹침 주석 포함) — 그리드 렌더·지표가 같은 값을 본다. */
export function dayIntervalsOf(bucket: RoomBucket, day: DayOfWeek): { intervals: RoomInterval[]; conflictPairs: number } {
  return annotateOverlaps(classIntervalsExact(bucket.slots.filter((s) => s.dayOfWeek === day)));
}

export function buildRoomWeekRows(buckets: readonly RoomBucket[], windows: DayWindows): RoomWeekRow[] {
  return buckets.map((b) => {
    const days = {} as Record<DayOfWeek, RoomDayMetric>;
    let weekOccupiedMin = 0;
    let weekdayOccupied = 0;
    let maxStudents = 0;
    for (const day of ROOM_DAY_ORDER) {
      const { intervals, conflictPairs } = dayIntervalsOf(b, day);
      const occupied = occupiedMinutes(intervals);
      const students = intervals.reduce((a, iv) => a + iv.students, 0);
      for (const iv of intervals) maxStudents = Math.max(maxStudents, iv.students);
      days[day] = {
        occupiedMin: occupied,
        utilPct: utilPct(occupied, windows[day]),
        sessions: intervals.length,
        students,
        conflictPairs,
      };
      weekOccupiedMin += occupied;
      if (WEEKDAYS.includes(day)) weekdayOccupied += occupied;
    }
    const weekdayDen = WEEKDAYS.reduce((a, d) => {
      const w = windows[d];
      return a + (w ? w.endMin - w.startMin : 0);
    }, 0);
    return {
      key: b.key,
      name: b.name,
      capacity: b.capacity,
      registered: b.registered,
      days,
      weekdayUtilPct: weekdayDen > 0 ? Math.round((weekdayOccupied / weekdayDen) * 100) : null,
      weekOccupiedMin,
      maxStudents,
      seatOver: b.capacity != null && b.capacity > 0 && maxStudents > b.capacity,
    };
  });
}

// ── 시간대별 활성도(원장 요청 2026-08-03: "시간대별 활성도도 교실별로") ─────────
// 주중(월~금) 1시간 밴드 × 교실 매트릭스 — "어느 교실이 어느 시간대에 노는가".
// 분모는 밴드∩그 요일 운영 창(창 밖 구간은 안 센다 — 13:30 개원이면 13시 밴드 분모는 30분×5일).

export type RoomHourBand = { startMin: number; endMin: number; label: string };

/** 주중 운영 창(요일별 관측 확장 포함 합집합)을 1시간 밴드로 분할. 창이 없으면 []. */
export function weekdayHourBands(windows: DayWindows): RoomHourBand[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of WEEKDAYS) {
    const w = windows[d];
    if (!w) continue;
    lo = Math.min(lo, w.startMin);
    hi = Math.max(hi, w.endMin);
  }
  if (hi <= lo) return [];
  const start = Math.floor(lo / 60) * 60;
  const end = Math.ceil(hi / 60) * 60;
  const out: RoomHourBand[] = [];
  for (let m = start; m < end; m += 60) {
    out.push({ startMin: m, endMin: m + 60, label: `${Math.floor(m / 60)}시` });
  }
  return out;
}

export type RoomHourRow = {
  key: string;
  name: string;
  registered: boolean;
  /** 밴드별 주중 점유율 % — null=그 밴드가 운영 창과 아예 안 겹침(0%로 속이지 않는다). */
  cells: (number | null)[];
};

export function buildRoomHourRows(
  buckets: readonly RoomBucket[],
  windows: DayWindows,
): { bands: RoomHourBand[]; rows: RoomHourRow[] } {
  const bands = weekdayHourBands(windows);
  const rows = buckets.map((b) => {
    // 요일별 구간은 밴드 루프 밖에서 1회만 계산(밴드×요일 중복 계산 방지).
    const byDay = WEEKDAYS.map((d) => ({ win: windows[d], intervals: dayIntervalsOf(b, d).intervals }));
    const cells = bands.map((band) => {
      let occ = 0;
      let den = 0;
      for (const { win, intervals } of byDay) {
        if (!win) continue;
        const clipLo = Math.max(band.startMin, win.startMin);
        const clipHi = Math.min(band.endMin, win.endMin);
        if (clipHi <= clipLo) continue;
        den += clipHi - clipLo;
        occ += occupiedMinutes(
          intervals
            .map((iv) => ({ startMin: Math.max(iv.startMin, clipLo), endMin: Math.min(iv.endMin, clipHi) }))
            .filter((iv) => iv.endMin > iv.startMin),
        );
      }
      return den > 0 ? Math.round((occ / den) * 100) : null;
    });
    return { key: b.key, name: b.name, registered: b.registered, cells };
  });
  return { bands, rows };
}

export type RoomDaySummary = {
  roomsTotal: number;
  /** 선택 요일에 수업이 1개라도 있는 등록 교실 수. */
  roomsUsed: number;
  /** 선택 요일 전체 가동률 = Σ점유분 / (등록 교실 수 × 창 길이). 창 없으면 null. */
  dayUtilPct: number | null;
  conflictPairs: number;
  /** 지금 이 순간 수업 중인 교실 수(오늘일 때만 의미 — 호출부가 오늘 여부 판단). */
  roomsInUseNow: number;
};

/** 선택 요일 요약 — 미등록(라벨) 버킷은 지도에는 그리되 가동률 분모(등록 교실 수)에선 제외. */
export function summarizeDay(
  buckets: readonly RoomBucket[],
  windows: DayWindows,
  day: DayOfWeek,
  nowMin: number,
): RoomDaySummary {
  const registered = buckets.filter((b) => b.registered);
  const win = windows[day];
  let occupiedTotal = 0;
  let roomsUsed = 0;
  let conflictPairs = 0;
  let roomsInUseNow = 0;
  for (const b of buckets) {
    const { intervals, conflictPairs: pairs } = dayIntervalsOf(b, day);
    conflictPairs += pairs;
    if (b.registered) {
      const occ = occupiedMinutes(intervals);
      occupiedTotal += occ;
      if (occ > 0) roomsUsed++;
    }
    if (intervals.some((iv) => iv.startMin <= nowMin && nowMin < iv.endMin)) roomsInUseNow++;
  }
  const den = win && registered.length > 0 ? (win.endMin - win.startMin) * registered.length : 0;
  return {
    roomsTotal: registered.length,
    roomsUsed,
    dayUtilPct: den > 0 ? Math.round((occupiedTotal / den) * 100) : null,
    conflictPairs,
    roomsInUseNow,
  };
}
