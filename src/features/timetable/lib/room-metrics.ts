// 교실뷰 활성도 지표 — 운영 창(교시 설정) 대비 점유율·요일별/주간 매트릭스·요약.
// 순수 모듈(클라/서버 공용, Vitest room-metrics.test.ts). 교시 시각은 학원설정
// (operations.weekdayPeriods/weekendPeriods + 과목별 override) 단일 소스 — 하드코딩 금지.

import type { DayOfWeek, PeriodsConfig } from "./periods";
import { subjectWeekdayPeriods, subjectWeekendPeriods } from "./periods";
import { timeToMin } from "./ten-minute-grid";
import {
  annotateOverlaps,
  classIntervalsExact,
  collectConflictPairs,
  concurrencySegments,
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

/**
 * **화면이 실제로 그리는 창** — 운영 창에 평일 하한([WEEKDAY_HOUR_FLOOR_MIN])을 적용한 것.
 *
 * 🔴 지표의 분모는 반드시 여기여야 한다(2026-08-04 적대 리뷰). 그 전에는 분모가 관측 확장까지 포함한
 * 운영 창(실측 평일 09:00~22:00 = 780분)이었는데 표는 14:00부터(480분)만 그려서, 화면의 "가동률 26%"를
 * 표로 세어봐도 절대 안 맞았다(보이는 범위로 계산하면 40%). 게다가 **한 방의 오전 특강 하나가 22개 방
 * 전체의 가동률을 끌어내렸다** — 분모가 3시간 늘어나므로.
 */
export function visibleDayWindow(windows: DayWindows, day: DayOfWeek): DayWindow | null {
  const win = windows[day];
  if (!win) return null;
  const lo = isWeekendDay(day) ? win.startMin : Math.max(win.startMin, WEEKDAY_HOUR_FLOOR_MIN);
  return win.endMin > lo ? { startMin: lo, endMin: win.endMin } : null;
}

/** 창 밖으로 삐져나간 부분을 잘라 낸 구간들 — 분자(점유)도 분모와 같은 범위를 봐야 %가 참이 된다. */
function clipTo(
  intervals: readonly { startMin: number; endMin: number }[],
  window: DayWindow | null,
): { startMin: number; endMin: number }[] {
  if (!window) return [];
  return intervals
    .map((iv) => ({
      startMin: Math.max(iv.startMin, window.startMin),
      endMin: Math.min(iv.endMin, window.endMin),
    }))
    .filter((iv) => iv.endMin > iv.startMin);
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
      // 분자도 **보이는 창**으로 자른다 — 분모만 좁히면 100%를 넘는 가동률이 나온다.
      const win = visibleDayWindow(windows, day);
      const occupied = occupiedMinutes(clipTo(intervals, win));
      const students = intervals.reduce((a, iv) => a + iv.students, 0);
      // 좌석 압박은 **동시 인원 합**으로 본다(반 하나만 보면 8명+9명=17명인 방을 "9명"이라 말한다).
      for (const seg of concurrencySegments(intervals)) maxStudents = Math.max(maxStudents, seg.students);
      days[day] = {
        occupiedMin: occupied,
        utilPct: utilPct(occupied, win),
        sessions: intervals.length,
        students,
        conflictPairs,
      };
      weekOccupiedMin += occupied;
      if (WEEKDAYS.includes(day)) weekdayOccupied += occupied;
    }
    const weekdayDen = WEEKDAYS.reduce((a, d) => {
      const w = visibleDayWindow(windows, d);
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

// ── 하단 반 목록(정원 초과 · 시간 겹침) ────────────────────────────────────────────────
//
// 원장 요청 2026-08-04: *"시간 겹침건도, 정원 초과건처럼 하단에 반목록 리스트"* ·
// *"누르면 수업상세 들어가도록 상호작용"*.
//
// 표는 "어느 교실이 언제 붐비나"까지만 말하고 **반 이름을 못 준다** — 특히 겹침은 한 칸에 대표 반
// 하나만 서므로(인원 많은 쪽) **가려진 반은 화면 어디에도 안 나온다**. 이 두 목록이 그 구멍을 메운다.
//
// ⚠️ 스코프 = **선택 요일**(원장 2026-08-04 재지시: *"현재 요일 선택한것만 나오면 됨. 정원 초과건도 마찬가지"* —
//    처음엔 주간으로 냈다가 뒤집혔다). 덕분에 위 표의 빨간 테두리·상단 요약의 "N건"·이 목록이 **전부 같은
//    하루**를 말한다. 다른 요일은 요일 칩으로 넘어가서 본다.
//    → `day`를 주면 그 요일만, 안 주면 주간 전체(테스트·미래 소비처용).

export type RoomConflictRow = {
  key: string;
  roomName: string;
  day: DayOfWeek;
  /** 두 반이 실제로 같은 방에 있는 구간(교집합) — "언제부터 언제까지"가 이 줄의 핵심. */
  startMin: number;
  endMin: number;
  classes: [RoomConflictClass, RoomConflictClass];
};

export type RoomConflictClass = {
  classId: string;
  className: string;
  startMin: number;
  endMin: number;
};

/**
 * 시간 겹침(부분 겹침 = 이중예약 의심) 목록. **합반(완전 동일 범위)은 제외** — 판정은
 * [collectConflictPairs] 한 곳이라 상단 요약의 "N건"과 술어가 같다.
 * 정렬 = 요일 → **시작 시각** → 강의실 = 위 표를 훑는 순서(눈이 표와 목록을 오갈 때 자리를 안 잃는다).
 */
export function collectRoomConflicts(
  buckets: readonly RoomBucket[],
  only?: DayOfWeek,
): RoomConflictRow[] {
  const out: RoomConflictRow[] = [];
  const days = only ? [only] : ROOM_DAY_ORDER;
  for (const b of buckets) {
    for (const day of days) {
      const intervals = classIntervalsExact(b.slots.filter((s) => s.dayOfWeek === day));
      for (const [a, c] of collectConflictPairs(intervals)) {
        out.push({
          key: `${b.key}|${day}|${a.classId}|${c.classId}|${a.startMin}`,
          roomName: b.name,
          day,
          startMin: Math.max(a.startMin, c.startMin),
          endMin: Math.min(a.endMin, c.endMin),
          classes: [ref(a), ref(c)],
        });
      }
    }
  }
  return out.sort(
    (x, y) =>
      ROOM_DAY_ORDER.indexOf(x.day) - ROOM_DAY_ORDER.indexOf(y.day) ||
      x.startMin - y.startMin ||
      x.roomName.localeCompare(y.roomName, "ko"),
  );
}

const ref = (iv: RoomInterval): RoomConflictClass => ({
  classId: iv.classId,
  className: iv.className,
  startMin: iv.startMin,
  endMin: iv.endMin,
});

export type RoomSeatOverRow = {
  key: string;
  roomName: string;
  capacity: number;
  day: DayOfWeek;
  startMin: number;
  endMin: number;
  /** 그 시간 그 방에 **동시에** 있는 반들(인원 많은 순). 한 반만일 수도, 여럿일 수도 있다. */
  classes: { classId: string; className: string; students: number }[];
  /** Σ classes.students — 이 값이 정원과 비교되는 실제 인원. */
  students: number;
};

/**
 * 정원 초과 목록 — 그 시간 그 방에 **실제로 몇 명이 있는지**로 판정한다.
 *
 * 🔴 반 단위 비교에서 **동시 인원 합**으로 바꿨다(2026-08-04 적대 리뷰). 정원 10명 방에 8명 반 + 9명 반이
 * 같이 있으면 사람은 17명인데, 반 하나씩 보면 둘 다 정원 이하라 화면이 "자리 남음"이라고 말했다 —
 * 실측 **34건**이 그렇게 침묵하고 있었다. 붐비는 순간을 못 잡으면 이 화면은 존재 이유가 없다.
 * ⚠️ 자리(JJ·LAB) 레인도 **인원은 합산한다** — 이중예약이 아니라는 것과 사람이 없다는 건 다른 말이다.
 * ⚠️ 정원이 없는 방은 애초에 판정 대상이 아니다(0으로 속이지 않는다 — `seatPct`가 null인 것과 같은 규약).
 * 정렬 = 요일 → **시작 시각** → 강의실. 초과 폭 순이 아니다(2026-08-04 가독성 지시) — 위 표와 같은
 * 순서로 읽히는 게 "심한 순"보다 찾기 쉽고, 심각도는 숫자가 말한다.
 * 📌 실측 건수(2026-08-04, 합산 도입 후): 평일 주 37건 = 요일당 평균 7건. 전에는 반 단위라 8건뿐이었다.
 *    ⚠️ 지금 이 학원 `classrooms.capacity`는 22실 전부 10(사실상 기본값)이라, 정원을 실제 좌석 수로
 *    고쳐 넣기 전까지 이 목록은 "정원 입력이 부정확하다"는 신호도 함께 담고 있다.
 */
export function collectSeatOver(buckets: readonly RoomBucket[], only?: DayOfWeek): RoomSeatOverRow[] {
  const out: RoomSeatOverRow[] = [];
  const days = only ? [only] : ROOM_DAY_ORDER;
  for (const b of buckets) {
    const cap = b.capacity;
    if (cap == null || cap <= 0) continue;
    for (const day of days) {
      const intervals = classIntervalsExact(b.slots.filter((s) => s.dayOfWeek === day));
      for (const seg of concurrencySegments(intervals)) {
        if (seg.students <= cap) continue;
        const members = [...seg.members].sort((x, y) => y.students - x.students || x.startMin - y.startMin);
        out.push({
          key: `${b.key}|${day}|${seg.startMin}|${members.map((m) => m.classId).join(",")}`,
          roomName: b.name,
          capacity: cap,
          day,
          startMin: seg.startMin,
          endMin: seg.endMin,
          classes: members.map((m) => ({ classId: m.classId, className: m.className, students: m.students })),
          students: seg.students,
        });
      }
    }
  }
  return out.sort(
    (x, y) =>
      ROOM_DAY_ORDER.indexOf(x.day) - ROOM_DAY_ORDER.indexOf(y.day) ||
      x.startMin - y.startMin ||
      x.roomName.localeCompare(y.roomName, "ko"),
  );
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

/** 블록에 동시에 들어 있는 반 하나 — 툴팁이 "누가 몇 명"까지 말할 수 있게 원본을 싣는다. */
export type RoomTimelineMember = {
  classId: string;
  className: string;
  teacherLabel: string | null;
  subject: string;
  /** 실제 수업 시각(격자 스냅 전). */
  startMin: number;
  endMin: number;
  students: number;
};

export type RoomTimelineCell =
  | { kind: "gap"; span: number }
  | {
      kind: "class";
      /** 격자 칸 수 = colspan. */
      span: number;
      /**
       * 이 시간대에 **동시에** 있는 반들(인원 많은 순). 보통 1개, 합반·병렬 레인이면 여럿.
       * 🔑 여럿일 때 대표 하나만 그리면 나머지 반은 화면 어디에도 안 남는다 — 툴팁이 전부 말한다.
       */
      members: RoomTimelineMember[];
      /** 대표(=인원 많은 쪽) — 좁은 칸에 한 줄만 쓸 때 쓴다. */
      classId: string;
      className: string;
      teacherLabel: string | null;
      subject: string;
      startMin: number;
      endMin: number;
      /** Σ members.students — 그 방에 실제로 있는 인원(동시 수업 합산). */
      students: number;
      /** 인원률 = 인원 ÷ 정원. 정원 미입력이면 null(0%로 속이지 않는다). */
      seatPct: number | null;
      isSpecialLecture: boolean;
      /** conflict=부분 겹침(이중예약 의심), joint=완전 동일 범위(합반). 자리 레인은 겹침이 아니다. */
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
 * 교실별 타임라인 행. 한 행 안에서 블록은 겹치지 않는다 — 같은 시간에 여러 반이 있으면(합반·병렬 레인·
 * 이중예약) **한 블록에 전부 담고 인원을 합산**한다(2026-08-04 적대 리뷰).
 *
 * 🔴 전에는 칸마다 인원 많은 반 하나만 골라 세웠다. 그러면 ① 8명+9명이 있는 방이 "9명"으로 보여 정원
 * 초과를 놓치고(실측 34건) ② **가려진 반 이름이 화면 어디에도 안 남았다**(합반 68쌍). 지금은 블록이
 * 그 시간대 방의 실제 인원을 말하고, `members`에 반이 전부 들어 있어 툴팁이 이름을 다 부른다.
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
    let run: { key: string; members: RoomInterval[]; span: number } = { key: "", members: [], span: 0 };

    const flush = () => {
      if (run.span === 0) return;
      const members = run.members;
      if (members.length === 0) {
        cells.push({ kind: "gap", span: run.span });
      } else {
        const students = members.reduce((a, m) => a + m.students, 0);
        const lead = members[0]!;
        cells.push({
          kind: "class",
          span: run.span,
          members: members.map((m) => ({
            classId: m.classId,
            className: m.className,
            teacherLabel: m.teacherLabel,
            subject: m.subject,
            startMin: m.startMin,
            endMin: m.endMin,
            students: m.students,
          })),
          classId: lead.classId,
          className: lead.className,
          teacherLabel: lead.teacherLabel,
          subject: lead.subject,
          startMin: Math.min(...members.map((m) => m.startMin)),
          endMin: Math.max(...members.map((m) => m.endMin)),
          students,
          seatPct:
            b.capacity != null && b.capacity > 0 && students > 0
              ? Math.round((students / b.capacity) * 100)
              : null,
          isSpecialLecture: members.every((m) => m.isSpecialLecture),
          // 겹침 표시는 가장 무거운 것으로(conflict > joint). 자리 레인은 애초에 겹침으로 안 센다.
          overlap: members.some((m) => m.overlap === "conflict")
            ? "conflict"
            : members.some((m) => m.overlap === "joint")
              ? "joint"
              : null,
        });
      }
      run = { key: "", members: [], span: 0 };
    };

    for (let i = 0; i < axis.slots; i++) {
      const lo = axis.startMin + i * TIMELINE_STEP_MIN;
      const hi = lo + TIMELINE_STEP_MIN;
      // 이 칸에 있는 반 **전부**(인원 많은 순, 같으면 먼저 시작한 쪽 → 결정적).
      const here = intervals
        .filter((iv) => iv.startMin < hi && iv.endMin > lo)
        .sort((x, y) => y.students - x.students || x.startMin - y.startMin || x.classId.localeCompare(y.classId));
      // 반 **집합**이 바뀔 때만 블록을 끊는다(대표 반이 같아도 옆 반이 들어오면 인원이 달라진다).
      const key = here.map((iv) => iv.classId).sort().join("|");
      if (key !== run.key) flush();
      run.key = key;
      run.members = here;
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

/**
 * 선택 요일 요약 — 미등록(라벨) 버킷은 표에는 그리되 가동률 분모(등록 교실 수)에선 제외.
 *
 * 🔴 가동률의 분자·분모 모두 **[visibleDayWindow]**(표가 실제로 그리는 범위)를 쓴다 — 2026-08-04 적대
 * 리뷰에서 "화면에 적힌 %를 표로 검산할 수 없다"가 확인됐다. 다만 **겹침 수는 안 자른다**: 하단 목록과
 * 같은 수를 말해야 하고, 표 밖(오전) 이중예약을 숨기는 건 더 나쁘다(목록이 '표 범위 밖'으로 표시한다).
 */
export function summarizeDay(
  buckets: readonly RoomBucket[],
  windows: DayWindows,
  day: DayOfWeek,
  nowMin: number,
): RoomDaySummary {
  const registered = buckets.filter((b) => b.registered);
  const win = visibleDayWindow(windows, day);
  let occupiedTotal = 0;
  let roomsUsed = 0;
  let conflictPairs = 0;
  let roomsInUseNow = 0;
  for (const b of buckets) {
    const { intervals, conflictPairs: pairs } = dayIntervalsOf(b, day);
    conflictPairs += pairs;
    if (b.registered) {
      const occ = occupiedMinutes(clipTo(intervals, win));
      occupiedTotal += occ;
      if (occ > 0) roomsUsed++;
      // ⚠️ 등록 교실만 센다 — 미등록(라벨) 버킷까지 세면 "강의실 22실"인데 "지금 수업 중 23실"이 된다.
      if (intervals.some((iv) => iv.startMin <= nowMin && nowMin < iv.endMin)) roomsInUseNow++;
    }
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
