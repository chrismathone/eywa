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

const isWeekendDay = (d: DayOfWeek): boolean => d === "sat" || d === "sun";

// ── 교실 활성도 타임라인 — 교실 × 10분 격자, 수업 시간대로 병합된 블록 ──────────────────────
//
// 원장 지시 2026-08-04: *"10분단위로 쪼개고 하단에 %를 수업 시간에 맞춰서 병합처리할 것"* ·
// *"예를 들어 15:00~16:20인 수업은 16:20까지 병합시키면 됨 80분을"* ·
// *"10분단위지만 열너비를 최소화하고 병합처리하면 80분수업이 적당한 너비가 될 것"*.
//
// 왜 1시간 밴드를 버렸나: 교시가 80·110분이라 시간 경계와 안 맞는다. 1시간 칸은 한 수업을 두 칸에
// 쪼개 놓고 각 칸에 **다른 %**를 적어, 실제로는 하나인 수업이 둘로 보였다. 10분 격자 + colspan 병합은
// **수업 하나 = 블록 하나**라 그 왜곡이 사라진다.
//
// 기준 요일은 **상단 요일 칩 1개**만 받는다(원장 확정 2026-08-03: "평균같은 건 필요없어, 절대적인 데이터").

/**
 * **평일 시작 하한(14:00).** 평일 오전 슬롯은 실측상 전부 특강(본원204 여름 특강)이라, 관측 확장이
 * 창을 10시까지 넓히면 표가 빈 칸으로 길어진다 — 원장 지시 2026-08-04
 * *"평일수업만 14시 이전 숨김 / 주말은 여전히 9시부터"*.
 *
 * ⚠️ **주말엔 적용하지 않는다** — 토요일 09~14시엔 정규 개별반이 실제로 돈다(고등M 개별 토일·고등M 고1 BS4F 토).
 * ⚠️ 평일 14시 이전에도 수업(특강)은 **실제로 있다** — 이 표에서 안 보일 뿐이다. 하한을 더 올리거나
 *    다른 축으로 옮기기 전에, 그 시간대 수업이 어디서도 안 보이게 되는 건 아닌지 확인할 것.
 */
export const WEEKDAY_HOUR_FLOOR_MIN = 14 * 60;

/** 격자 한 칸 = 10분. 교시 시각이 전부 10분 배수라 스냅 손실이 없다(안 맞으면 바깥쪽으로 스냅). */
export const TIMELINE_STEP_MIN = 10;

export type RoomTimelineCell =
  | { kind: "gap"; span: number }
  | {
      kind: "class";
      /** 격자 칸 수 = colspan. */
      span: number;
      classId: string;
      className: string;
      teacherLabel: string | null;
      subject: string;
      /** 실제 수업 시각(격자 스냅 전) — 툴팁이 진실을 말하도록 원본을 싣는다. */
      startMin: number;
      endMin: number;
      students: number;
      /** 인원률 = 인원 ÷ 정원. 정원 미입력이면 null(0%로 속이지 않는다). */
      seatPct: number | null;
      isSpecialLecture: boolean;
      /** conflict=부분 겹침(이중예약 의심), joint=완전 동일 범위(합반). */
      overlap: "conflict" | "joint" | null;
    };

export type RoomTimelineRow = {
  key: string;
  name: string;
  registered: boolean;
  capacity: number | null;
  cells: RoomTimelineCell[];
};

export type TimelineAxis = {
  startMin: number;
  endMin: number;
  /** 10분 칸 총 개수 = colgroup 열 수. */
  slots: number;
  /** 머리글용 1시간 묶음(각 6칸). 창 끝이 정시가 아니면 마지막 묶음만 짧다. */
  hours: { startMin: number; label: string; span: number }[];
};

/**
 * 그 요일의 격자 축. 평일은 [WEEKDAY_HOUR_FLOOR_MIN] 하한, 주말은 창 그대로(위 상수 주석 참조).
 * 창이 없거나 하한 뒤로 남는 시간이 없으면 slots=0.
 */
export function timelineAxis(windows: DayWindows, day: DayOfWeek): TimelineAxis {
  const win = windows[day];
  const empty: TimelineAxis = { startMin: 0, endMin: 0, slots: 0, hours: [] };
  if (!win) return empty;
  const lo = isWeekendDay(day) ? win.startMin : Math.max(win.startMin, WEEKDAY_HOUR_FLOOR_MIN);
  if (win.endMin <= lo) return empty;
  const startMin = Math.floor(lo / 60) * 60;
  const endMin = Math.ceil(win.endMin / TIMELINE_STEP_MIN) * TIMELINE_STEP_MIN;
  const slots = Math.round((endMin - startMin) / TIMELINE_STEP_MIN);
  const hours: TimelineAxis["hours"] = [];
  for (let m = startMin; m < endMin; m += 60) {
    const h = Math.floor(m / 60);
    // 마지막 묶음은 창 끝에서 잘린다(6칸 고정으로 적으면 표가 축보다 길어져 열이 어긋난다).
    const span = Math.round((Math.min(m + 60, endMin) - m) / TIMELINE_STEP_MIN);
    hours.push({ startMin: m, label: `${h}~${h + 1}시`, span });
  }
  return { startMin, endMin, slots, hours };
}

/**
 * 교실별 타임라인 행. 한 행 안에서 블록은 **겹치지 않는다** — 같은 시간에 두 반이 있으면(합반·이중예약)
 * 칸마다 **인원이 큰 쪽**을 골라 대표로 세우고 `overlap`으로 표시한다(좌석 압박을 과소평가하지 않는 쪽).
 * ⚠️ 겹침 자체를 지우는 게 아니다 — 블록에 `overlap` 테두리가 남고, 상단 요약이 "시간 겹침 N건"으로 센다.
 *    다만 **가려진 반의 이름은 이 화면에 안 나온다** — 겹침을 파고들 땐 시간표 기본뷰/통합뷰로 갈 것.
 */
export function buildRoomTimelineRows(
  buckets: readonly RoomBucket[],
  windows: DayWindows,
  day: DayOfWeek,
): { axis: TimelineAxis; rows: RoomTimelineRow[] } {
  const axis = timelineAxis(windows, day);
  if (axis.slots === 0) return { axis, rows: [] };

  const rows = buckets.map((b): RoomTimelineRow => {
    const intervals = dayIntervalsOf(b, day).intervals;
    const cells: RoomTimelineCell[] = [];
    let run: { iv: (typeof intervals)[number] | null; span: number } = { iv: null, span: 0 };

    const flush = () => {
      if (run.span === 0) return;
      const iv = run.iv;
      if (!iv) {
        cells.push({ kind: "gap", span: run.span });
      } else {
        cells.push({
          kind: "class",
          span: run.span,
          classId: iv.classId,
          className: iv.className,
          teacherLabel: iv.teacherLabel,
          subject: iv.subject,
          startMin: iv.startMin,
          endMin: iv.endMin,
          students: iv.students,
          seatPct:
            b.capacity != null && b.capacity > 0 && iv.students > 0
              ? Math.round((iv.students / b.capacity) * 100)
              : null,
          isSpecialLecture: iv.isSpecialLecture,
          overlap: iv.overlap,
        });
      }
      run = { iv: null, span: 0 };
    };

    for (let i = 0; i < axis.slots; i++) {
      const lo = axis.startMin + i * TIMELINE_STEP_MIN;
      const hi = lo + TIMELINE_STEP_MIN;
      // 이 칸을 덮는 수업 중 대표 하나 — 인원 많은 쪽, 같으면 먼저 시작한 쪽(결정적).
      let best: (typeof intervals)[number] | null = null;
      for (const iv of intervals) {
        if (iv.startMin >= hi || iv.endMin <= lo) continue;
        if (
          !best ||
          iv.students > best.students ||
          (iv.students === best.students && iv.startMin < best.startMin)
        ) {
          best = iv;
        }
      }
      if (run.iv?.classId !== best?.classId) flush();
      run.iv = best;
      run.span += 1;
    }
    flush();
    return { key: b.key, name: b.name, registered: b.registered, capacity: b.capacity, cells };
  });

  return { axis, rows };
}

/**
 * 축 전환(시간=세로)용 색인 — 한 교실의 셀 목록을 **격자 칸 수만큼의 배열**로 편다.
 * 칸 i에는 "그 칸에서 시작하는 셀"만 들어가고, 병합에 덮인 칸은 `null`이다(= rowSpan이 이미 그린 자리라
 * 거기 다시 `<td>`를 그리면 표가 오른쪽으로 밀린다).
 *
 * ⚠️ 빈 구간은 **10분마다 쪼개서** 넣는다 — 통째로 병합하면 그 구간엔 시간 눈금이 한 줄도 안 남는다
 *    (가로 모드에서 gap을 colspan으로 묶지 않는 것과 같은 이유).
 * ⚠️ 축만 뒤집는 것이라 원본 셀을 그대로 싣는다 — 수업 블록의 span·인원·인원률·겹침 표시는 두 축이 공유한다.
 */
export function timelineColumnCells(
  cells: readonly RoomTimelineCell[],
  slots: number,
): (RoomTimelineCell | null)[] {
  const out: (RoomTimelineCell | null)[] = Array.from({ length: slots }, () => null);
  let i = 0;
  for (const c of cells) {
    if (c.kind === "gap") {
      for (let k = 0; k < c.span && i + k < slots; k++) out[i + k] = { kind: "gap", span: 1 };
    } else if (i < slots) {
      out[i] = c;
    }
    i += c.span;
  }
  return out;
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
