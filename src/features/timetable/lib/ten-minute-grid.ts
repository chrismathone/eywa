// 영어 강사뷰 10분 격자 축 — 시트 "강사별영어시간표"의 10분 단위 행을 그대로 미러.
// 순수 모듈 (클라/서버 공용 — server-only 금지 [[#61]]).
//
// 시트는 14:20부터 10분 행으로 내려가며 수업 블록을 세로 병합으로 그린다. aywa 강사뷰도
// 같은 축을 쓰되, 행 목록은 "슬롯 데이터 범위 ∪ 폴백(14:20~22:00)"으로 만들어
// 빈 주에도 시트 프레임(46행)이 유지되고, 범위 밖 슬롯이 있으면 바깥쪽 라운딩으로 확장된다.

export const STEP_MIN = 10;

/** 시트 프레임 기본 범위 — 통합영어시간표 교시(14:20~22:00, 46행). */
export const ENGLISH_GRID_FALLBACK = { start: "14:20", end: "22:00" };

/** 강사뷰 내부 가로줄 기본(영어) — 과목 설정(teacherViewLines) 미설정 시 폴백(2026-07-06 사용자 지정 6시각). */
export const DEFAULT_TEACHER_VIEW_LINES = ["16:10", "18:00", "18:20", "19:10", "20:00", "20:20"];

export type TenMinuteRow = {
  /** 행 시작 "HH:MM" — td key·시각 라벨 겸용 */
  key: string;
  /** 자정 기준 분 */
  startMin: number;
  /** 정시(HH:00) — 라벨·격자선 강조용 */
  isHour: boolean;
};

/** "HH:MM" | "HH:MM:SS" → 자정 기준 분. 파싱 실패 시 null (throw 금지). */
export function timeToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(min) ? min : null;
}

export const minToHM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const floorStep = (min: number, step: number = STEP_MIN) => Math.floor(min / step) * step;
const ceilStep = (min: number, step: number = STEP_MIN) => Math.ceil(min / step) * step;

/**
 * 슬롯들로 시간 격자 행 축 구성 — 데이터 min~max를 바깥쪽 라운딩 후 폴백 범위와 합집합.
 * 빈 배열이어도 폴백 프레임을 반환(빈 주 렌더 보장). stepMin은 격자 단위(분, 기본 10 —
 * 과목 설정 teacherViewStep). ⚠️ 축 경계도 step 배수로 스냅(자정 기준) — 14:20은 30의 배수가
 * 아니라 step 30이면 lo=14:00으로 내림(안 하면 slotRowSpan이 분수 인덱스를 만든다).
 */
export function buildTenMinuteRows(
  slots: readonly { startTime: string; endTime: string }[],
  fallback: { start: string; end: string } = ENGLISH_GRID_FALLBACK,
  stepMin: number = STEP_MIN,
): TenMinuteRow[] {
  let lo = floorStep(timeToMin(fallback.start) ?? 860, stepMin);
  let hi = ceilStep(timeToMin(fallback.end) ?? 1320, stepMin);
  for (const s of slots) {
    const a = timeToMin(s.startTime);
    const b = timeToMin(s.endTime);
    if (a != null) lo = Math.min(lo, floorStep(a, stepMin));
    if (b != null) hi = Math.max(hi, ceilStep(b, stepMin));
  }
  const rows: TenMinuteRow[] = [];
  for (let m = lo; m < hi; m += stepMin) {
    rows.push({ key: minToHM(m), startMin: m, isHour: m % 60 === 0 });
  }
  return rows;
}

/** 행 축에서 격자 단위(분) 추론 — 행 2개 미만이면 기본 10. */
function stepOf(rows: readonly TenMinuteRow[]): number {
  return rows.length >= 2 ? rows[1]!.startMin - rows[0]!.startMin : STEP_MIN;
}

/**
 * 슬롯 → {index, span}. start는 내림·end는 올림으로 격자 정렬, 축 범위로 클램프,
 * span ≥ 1 보장 — 역전/동일 시각/파싱 실패 어떤 입력에도 throw하지 않는다.
 * step은 rows에서 추론(시그니처 불변 — 호출부 무변).
 */
export function slotRowSpan(
  rows: readonly TenMinuteRow[],
  startTime: string,
  endTime: string,
): { index: number; span: number } {
  if (rows.length === 0) return { index: 0, span: 1 };
  const step = stepOf(rows);
  const lo = rows[0]!.startMin;
  const hi = rows[rows.length - 1]!.startMin + step;
  const rawStart = timeToMin(startTime);
  const rawEnd = timeToMin(endTime);
  const start = Math.min(Math.max(rawStart != null ? floorStep(rawStart, step) : lo, lo), hi - step);
  const end = Math.min(Math.max(rawEnd != null ? ceilStep(rawEnd, step) : start + step, start + step), hi);
  const index = (start - lo) / step;
  const span = (end - start) / step;
  return { index, span };
}

/**
 * 한 컬럼(강사×요일)의 행별 피복 슬롯 — covering: 행 시작이 [슬롯 start, 슬롯 end) 안이면 피복.
 * (half-open: 15:00~15:40 슬롯은 15:00·15:10·15:20·15:30 행을 덮고 15:40 행은 안 덮는다.)
 */
export function buildCoveringRows<T extends { startTime: string; endTime: string }>(
  rows: readonly TenMinuteRow[],
  slots: readonly T[],
): T[][] {
  const out: T[][] = rows.map(() => []);
  for (const s of slots) {
    const { index, span } = slotRowSpan(rows, s.startTime, s.endTime);
    for (let i = index; i < index + span && i < out.length; i++) out[i]!.push(s);
  }
  return out;
}

// ── 쉬는 시간(수업 사이 휴식 밴드) ──────────────────────────────────────────────
// 과목 설정 teacherViewBreaks("HH:MM"~"HH:MM")를 강사뷰에 표시. 시트처럼 "쉬는 시간" 밴드가
// **앞뒤로 수업이 붙은 강사 컬럼에만** 뜬다(범위 앞에 끝나는 수업 + 범위 끝에 시작하는 수업 = 수업 사이).

export type BreakRange = { startMin: number; endMin: number };

/** 쉬는 시간 설정 → 격자 스냅된 분 범위. 파싱 실패·역전(길이≤0)은 제외. */
export function parseBreakRanges(
  ranges: readonly { start: string; end: string }[] | undefined,
  stepMin: number = STEP_MIN,
): BreakRange[] {
  const out: BreakRange[] = [];
  for (const r of ranges ?? []) {
    const a = timeToMin(r.start);
    const b = timeToMin(r.end);
    if (a == null || b == null) continue;
    const s = floorStep(a, stepMin);
    const e = ceilStep(b, stepMin);
    if (e > s) out.push({ startMin: s, endMin: e });
  }
  return out;
}

/**
 * 한 컬럼(강사×요일)에서 렌더할 쉬는 시간 블록 — **앞뒤로 수업이 붙은** 경우만:
 * ① 범위 시작에 끝나는 수업이 있고 ② 범위 끝에 시작하는 수업이 있고 ③ 범위와 겹치는 수업이 없음
 * (= 두 수업 사이 쉬는 시간). 앞뒤 중 하나라도 붙은 수업이 없으면(장시간 공백·강사 부재) 미표시.
 * 축(rows) 범위 밖 범위는 제외(클램프하면 엉뚱한 셀). index/span은 rows 격자 기준.
 */
export function breakBlocksForColumn<T>(
  rows: readonly TenMinuteRow[],
  intervals: readonly ClassInterval<T>[],
  breaks: readonly BreakRange[],
): { index: number; span: number; startMin: number; endMin: number }[] {
  if (rows.length === 0) return [];
  const step = stepOf(rows);
  const lo = rows[0]!.startMin;
  const hi = rows[rows.length - 1]!.startMin + step;
  const out: { index: number; span: number; startMin: number; endMin: number }[] = [];
  for (const b of breaks) {
    if (b.startMin < lo || b.endMin > hi) continue; // 축 밖
    const hasBefore = intervals.some((iv) => iv.endMin === b.startMin);
    const hasAfter = intervals.some((iv) => iv.startMin === b.endMin);
    const overlaps = intervals.some((iv) => iv.startMin < b.endMin && iv.endMin > b.startMin);
    if (!hasBefore || !hasAfter || overlaps) continue;
    const { index, span } = slotRowSpan(rows, minToHM(b.startMin), minToHM(b.endMin));
    out.push({ index, span, startMin: b.startMin, endMin: b.endMin });
  }
  return out;
}

// ── LAB 다중 레인(시트 서브컬럼 미러) ──────────────────────────────────────────
// 시트 LAB 블록(JJ·이주희)은 한 시간대 병렬 반들을 요일당 여러 서브컬럼에 나란히 그린다.
// 같은 반의 back-to-back 슬롯을 구간으로 접고, 겹치는 구간을 그리디 interval coloring으로
// 레인에 배정 — 일반 강사(병렬 없음)는 자연히 1레인이라 화면 무변.

export type ClassInterval<T> = {
  classId: string;
  startMin: number;
  endMin: number;
  slots: T[];
};

/** 같은 반의 인접(끝=시작)·중복 슬롯을 하나의 구간으로 접기. 시각은 격자 단위 바깥쪽 라운딩. */
export function buildClassIntervals<
  T extends { startTime: string; endTime: string; classId: string },
>(slots: readonly T[], stepMin: number = STEP_MIN): ClassInterval<T>[] {
  const byClass = new Map<string, T[]>();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  const out: ClassInterval<T>[] = [];
  for (const [classId, group] of byClass) {
    const sorted = [...group].sort(
      (a, b) => (timeToMin(a.startTime) ?? 0) - (timeToMin(b.startTime) ?? 0),
    );
    for (const s of sorted) {
      const a = timeToMin(s.startTime);
      const b = timeToMin(s.endTime);
      const start = a != null ? floorStep(a, stepMin) : 0;
      const end = Math.max(b != null ? ceilStep(b, stepMin) : start + stepMin, start + stepMin);
      const prev = out[out.length - 1];
      if (prev && prev.classId === classId && start <= prev.endMin) {
        prev.endMin = Math.max(prev.endMin, end);
        prev.slots.push(s);
      } else {
        out.push({ classId, startMin: start, endMin: end, slots: [s] });
      }
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

/**
 * 슬롯 → 구간 **접기 없음**(시트 셀 1:1) — 같은 반이 2교시 연속이어도 시트처럼 **셀 2개**로 유지
 * (2026-07-06 사용자 지정: 시트는 한 수업의 연결 교시를 교시별 셀로 쪼개 그린다 — 검은 교시선).
 * DB 슬롯 자체가 시트 셀 단위(교시당 1행)라 슬롯=구간 1:1이 곧 시트 표현. 동일 (반,시각) 중복만 병합.
 */
export function buildSlotIntervals<
  T extends { startTime: string; endTime: string; classId: string },
>(slots: readonly T[], stepMin: number = STEP_MIN): ClassInterval<T>[] {
  const map = new Map<string, ClassInterval<T>>();
  for (const s of slots) {
    const a = timeToMin(s.startTime);
    const b = timeToMin(s.endTime);
    const start = a != null ? floorStep(a, stepMin) : 0;
    const end = Math.max(b != null ? ceilStep(b, stepMin) : start + stepMin, start + stepMin);
    const k = `${s.classId}:${start}:${end}`;
    const ex = map.get(k);
    if (ex) ex.slots.push(s);
    else map.set(k, { classId: s.classId, startMin: start, endMin: end, slots: [s] });
  }
  return [...map.values()].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

// ── 병렬 그룹 패킹(합반 묶음) ──────────────────────────────────────────────────
// 같은 시간 범위(start·end 동일)의 병렬 반들 = 한 그룹(합반) → 렌더에서 한 셀(colSpan)로 묶어
// 하나의 테두리 안에 나란히. 시간 범위가 다른 겹침만 별도 레인으로. 낱개 레인 흩어짐 방지.

export type PlacedGroup<T> = {
  startMin: number;
  endMin: number;
  /** 배치된 시작 레인(0-based)과 점유 레인 수(=병렬 반 수). */
  laneStart: number;
  laneWidth: number;
  /** 그룹 구성 반 구간들(반당 1개, classId 오름차순). 길이 ≥2면 합반. */
  intervals: ClassInterval<T>[];
};

/**
 * 구간들을 (start,end) 동일 그룹으로 묶고, 그룹 단위로 연속 빈 레인에 그리디 배치.
 * 반환 laneCount = 그 요일에 필요한 총 레인 수(겹침 없으면 1).
 */
export function packGroups<T>(intervals: readonly ClassInterval<T>[]): {
  groups: PlacedGroup<T>[];
  laneCount: number;
} {
  const byRange = new Map<string, ClassInterval<T>[]>();
  for (const iv of intervals) {
    const k = `${iv.startMin}:${iv.endMin}`;
    (byRange.get(k) ?? byRange.set(k, []).get(k)!).push(iv);
  }
  const raw = [...byRange.values()]
    .map((ivs) => ({
      startMin: ivs[0]!.startMin,
      endMin: ivs[0]!.endMin,
      intervals: [...ivs].sort((a, b) => a.classId.localeCompare(b.classId)),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const laneEnds: number[] = []; // 레인별 마지막 점유 endMin
  const groups: PlacedGroup<T>[] = [];
  for (const g of raw) {
    const width = g.intervals.length;
    // 첫 "연속 width개 빈 레인" 탐색(없으면 뒤에 증설).
    let start = 0;
    for (;;) {
      let ok = true;
      for (let l = start; l < start + width; l++) {
        if ((laneEnds[l] ?? 0) > g.startMin) {
          ok = false;
          start = l + 1;
          break;
        }
      }
      if (ok) break;
    }
    for (let l = start; l < start + width; l++) laneEnds[l] = g.endMin;
    groups.push({ ...g, laneStart: start, laneWidth: width });
  }
  return { groups, laneCount: Math.max(1, laneEnds.length) };
}
